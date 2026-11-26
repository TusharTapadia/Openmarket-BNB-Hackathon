import { NextResponse } from "next/server";
import { apiGet, fetchMarketData, fetchPriceHistory, normalizeCompanies, rows, text } from "@/lib/market-api";
import { attachReferences, slugify } from "@/lib/company-data";
import { derivativesSummary } from "@/lib/market-summary";
import { cached } from "@/lib/cache";
export const dynamic = "force-dynamic";

/**
 * A market row is covered when its name or any alias maps to a company we hold
 * data for. The covered set comes from the feed now rather than a constant, so
 * adding a company is a row in the database and not a deploy.
 */
function covered(row: Record<string, unknown>, slugs: Set<string>) {
  const aliases = Array.isArray(row.aliases) ? row.aliases.filter((item): item is string => typeof item === "string") : [];
  return [text(row.name), ...aliases].some((name) => name && slugs.has(slugify(name)));
}

/**
 * The whole assembled payload, cached under one key.
 *
 * Caching the individual upstream calls already avoids the feed, but it leaves
 * eighteen cache reads to serve one page, and the shared instance is ~235ms
 * away rather than co-located. One key for the finished response turns that
 * into a single read, and the per-call entries underneath it still cover the
 * other routes and the first build after an expiry.
 *
 * Sixty seconds, the same as the prices inside it: a payload held longer than
 * its own contents would report a reading as current that its parts no longer
 * agree with.
 */
const PAYLOAD_TTL_SECONDS = 60;

export async function GET() {
  try {
    return NextResponse.json(await cached("route:markets", PAYLOAD_TTL_SECONDS, build), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Market data is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

async function build() {
  {
    // Both feeds are required: without market data there is no covered set to
    // filter against, and the page would render every watchlist row.
    const [market, bySlug] = await Promise.all([
      apiGet("/external/watchlist/market-prices"),
      fetchMarketData(),
    ]);
    const covering = new Set(bySlug.keys());
    const listed = rows(market.data).filter((row) => covered(row, covering));
    // One profile lookup per company; profiles are optional, so a failed lookup
    // must not hide the prices that did load.
    const profileResults = await Promise.allSettled(
      listed.flatMap((row) => {
        const aliases = Array.isArray(row.aliases) ? row.aliases : [];
        const name = aliases.map(text).find(Boolean) ?? text(row.name);
        return name ? [apiGet(`/companies?all=true&name=${encodeURIComponent(name)}&limit=5`)] : [];
      }),
    );
    const profiles = profileResults.flatMap((result) => (result.status === "fulfilled" ? rows(result.value.data) : []));
    const priced = attachReferences(normalizeCompanies(listed, profiles), bySlug);
    // Fetched after the companies are known, because the slugs come from them.
    // History drives the change columns and sparkline; a company without it
    // still lists, it just has nothing to plot.
    const history = await fetchPriceHistory(priced.map((company) => company.slug));
    const companies = priced.map((company) => ({ ...company, history: history.get(company.slug) ?? [] }));
    return {
      companies,
      // Aggregated here rather than in the browser: the per-venue rows are
      // already in hand on this side and sending seventeen of them per company
      // to compute four totals would be the page's largest payload by far.
      derivatives: derivativesSummary(bySlug.values()),
      fetchedAt: new Date().toISOString(),
      profileUnavailable: profileResults.length > 0 && profileResults.every((result) => result.status === "rejected"),
    };
  }
}
