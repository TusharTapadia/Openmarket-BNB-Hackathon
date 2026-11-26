import { NextResponse } from "next/server";
import { apiGet, fetchMarketData, fetchPriceSeries, normalizeCompanies, rows, text } from "@/lib/market-api";
import { attachReferences, slugify, valuationBasis } from "@/lib/company-data";
import { companySeries, marketSeries, shareOfMarket, type CompanyPoint } from "@/lib/market-series";
import { derivativesSummary } from "@/lib/market-summary";
import { fearGreed } from "@/lib/fear-greed";
import { cached } from "@/lib/cache";
export const dynamic = "force-dynamic";

/**
 * Everything recorded, not a window.
 *
 * The index warms its trailing measurements on the first thirty days, and the
 * market series can only begin where every company it covers has a price. This
 * asks for everything the feed will give and lets those two decide the span.
 */
const WINDOW_DAYS = 365;

/** Same key-per-payload as the other feeds; see the overview route for why. */
const PAYLOAD_TTL_SECONDS = 60;

function covered(row: Record<string, unknown>, slugs: Set<string>) {
  const aliases = Array.isArray(row.aliases) ? row.aliases.filter((item): item is string => typeof item === "string") : [];
  return [text(row.name), ...aliases].some((name) => name && slugs.has(slugify(name)));
}

export async function GET() {
  try {
    return NextResponse.json(await cached("route:fear-greed", PAYLOAD_TTL_SECONDS, build), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Market data is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

async function build() {
  const [market, bySlug] = await Promise.all([
    apiGet("/external/watchlist/market-prices"),
    fetchMarketData(),
  ]);
  const covering = new Set(bySlug.keys());
  const listed = rows(market.data).filter((row) => covered(row, covering));
  const profileResults = await Promise.allSettled(
    listed.flatMap((row) => {
      const aliases = Array.isArray(row.aliases) ? row.aliases : [];
      const name = aliases.map(text).find(Boolean) ?? text(row.name);
      return name ? [apiGet(`/companies?all=true&name=${encodeURIComponent(name)}&limit=5`)] : [];
    }),
  );
  const profiles = profileResults.flatMap((result) => (result.status === "fulfilled" ? rows(result.value.data) : []));
  const companies = attachReferences(normalizeCompanies(listed, profiles), bySlug);
  const series = await fetchPriceSeries(companies.map((company) => company.slug), WINDOW_DAYS);

  const points = marketSeries(
    companies.map((company) => ({
      slug: company.slug,
      valuation: company.valuation,
      history: series.get(company.slug) ?? [],
    })),
  );
  const perCompany = new Map<string, readonly CompanyPoint[]>(
    companies.map((company) => [
      company.slug,
      companySeries(series.get(company.slug) ?? [], valuationBasis(company.price, company.valuation)),
    ]),
  );

  const reading = fearGreed({ market: points, companies: perCompany });
  const derivatives = derivativesSummary(bySlug.values());

  // What the reading is actually drawn from, which is not the whole list the
  // market page covers. A company the venues state no valuation for, or that
  // has no recorded price behind it, cannot be carried through its own price,
  // so the series leaves it out -- and the page should say so rather than let
  // "breadth: 2 of 5" be the only place the number appears.
  const counted = companies.filter(
    (company) => (company.valuation ?? 0) > 0 && (series.get(company.slug) ?? []).length > 0,
  );
  const shares = shareOfMarket(counted);

  return {
    fetchedAt: new Date().toISOString(),
    reading,
    // Reported beside the score, never inside it: only their current value is
    // stored, so a history drawn with them in would not match this gauge.
    context: {
      longPaying: derivatives.longPaying,
      shortPaying: derivatives.shortPaying,
      openInterest: derivatives.openInterest,
      volume: derivatives.volume,
      venueCount: derivatives.venueCount,
    },
    coverage: {
      counted: counted.length,
      covered: companies.length,
      /** The names left out, for the tooltip. */
      omitted: companies.filter((company) => !counted.includes(company)).map((company) => company.name),
      /** How much of the index the largest two carry. */
      topTwoShare: shares.slice(0, 2).reduce((sum, company) => sum + company.share, 0),
      /** The first day every counted company had a price. */
      startedAt: points[0]?.at ?? null,
    },
  };
}
