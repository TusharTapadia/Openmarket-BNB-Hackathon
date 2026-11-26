import { NextResponse } from "next/server";
import { apiGet, fetchMarketData, fetchPriceSeries, normalizeCompanies, rows, text } from "@/lib/market-api";
import { attachReferences, slugify, valuationBasis } from "@/lib/company-data";
import { derivativesSummary } from "@/lib/market-summary";
import { cached } from "@/lib/cache";
import { companySeries } from "@/lib/market-series";

export const dynamic = "force-dynamic";

/** How far back the charts reach. The ingest keeps every point; this is what one view asks for. */
const WINDOW_DAYS = 120;

function covered(row: Record<string, unknown>, slugs: Set<string>) {
  const aliases = Array.isArray(row.aliases) ? row.aliases.filter((item): item is string => typeof item === "string") : [];
  return [text(row.name), ...aliases].some((name) => name && slugs.has(slugify(name)));
}

/**
 * The market as a whole, over time.
 *
 * Same sources as the overview feed, folded differently: the overview asks
 * what each company is worth now, this asks what the market has been worth.
 * The folding happens here rather than in the browser because it reads six
 * histories to produce one line, and sending all six to do it would make the
 * series the page's largest payload for no gain.
 */
/** Same key-per-payload as the overview; see that route for why. */
const PAYLOAD_TTL_SECONDS = 60;

export async function GET() {
  try {
    return NextResponse.json(await cached("route:charts", PAYLOAD_TTL_SECONDS, build), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Market data is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

async function build() {
  {
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

    return {
      fetchedAt: new Date().toISOString(),
      // Per company, never summed. Each of these is one company's whole
      // valuation, so adding six together answers a question nobody asked --
      // and the six are not a market, they are the six we happen to track.
      companies: companies.map((company) => ({
        slug: company.slug,
        name: company.name,
        logo: company.logo,
        sector: company.sector,
        price: company.price,
        markPrice: company.markPrice,
        shares: company.shares,
        valuation: company.valuation,
        round: company.round,
        roundDate: company.roundDate,
        referenceVenues: company.referenceVenues,
        referenceVolume: company.referenceVolume,
        points: companySeries(series.get(company.slug) ?? [], valuationBasis(company.price, company.valuation)),
      })),
      derivatives: derivativesSummary(bySlug.values()),
      windowDays: WINDOW_DAYS,
    };
  }
}
