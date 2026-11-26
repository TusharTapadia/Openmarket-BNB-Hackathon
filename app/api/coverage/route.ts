import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { marketCoverage, marketHistory } from "@/lib/market-coverage";
import { COVERAGE_COMPANIES } from "@/lib/market-coverage/shared";
import { offchainData } from "@/lib/offchain";
import { issuerTokens } from "@/lib/issuers";
import { companyView, type CoverageCompany, type CoveragePayload } from "@/lib/coverage-view";

export const dynamic = "force-dynamic";
/** A cold read touches every venue; give it room on serverless hosts. */
export const maxDuration = 60;

/**
 * The covered companies with every market that trades them, their off-chain
 * price, and daily closes from each company's most-traded market for the
 * change columns and the price chart, plus other issuers' tokenized versions.
 *
 * Venues and off-chain prices are each cached for ten minutes underneath;
 * this holds the assembled payload for one so a page load is a single read.
 */
const PAYLOAD_TTL_SECONDS = 60;

export async function GET() {
  try {
    return NextResponse.json(await cached("route:coverage", PAYLOAD_TTL_SECONDS, build), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Market data is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

async function build(): Promise<CoveragePayload> {
  const companies = COVERAGE_COMPANIES.map(({ slug, name }) => ({ slug, name }));
  // Coverage is the page; off-chain prices and history only add columns, so
  // either failing leaves those columns empty rather than taking the page down.
  const [coverage, offchain, issuers] = await Promise.all([
    marketCoverage(),
    offchainData(companies).catch(() => null),
    issuerTokens().catch(() => ({} as Record<string, never[]>)),
  ]);
  type History = Pick<CoverageCompany, "series" | "seriesMarket">;
  const histories = new Map<string, History>(await Promise.all(coverage.companies.map(async (company): Promise<[string, History]> => {
    // The lead is the most-traded market on the main price basis, not a venue
    // quoting another unit.
    const view = companyView({ ...company, sector: null, logo: null, offchainPrice: null, offchainValuation: null, totalShares: null, history: [], series: [], seriesMarket: null, issuers: [] });
    const lead = view.main.find((row) => row.price !== null);
    if (!lead) { return [company.slug, { series: [], seriesMarket: null }]; }
    const series = await marketHistory(lead).catch(() => []);
    return [company.slug, {
      series,
      seriesMarket: series.length ? { label: lead.label, venue: lead.venue, provider: lead.provider } : null,
    }];
  })));
  return {
    fetchedAt: new Date().toISOString(),
    updatedAt: coverage.updatedAt,
    offchainAsOf: offchain?.asOf ?? null,
    failedSources: coverage.failedSources,
    companies: coverage.companies.map((company) => {
      const off = offchain?.companies.get(company.slug);
      return {
        ...company,
        sector: off?.sector ?? null,
        logo: off?.logo ?? null,
        offchainPrice: off?.price ?? null,
        offchainValuation: off?.marketCap ?? null,
        offchainValuationBasis: off?.valuationBasis ?? null,
        lastRoundValuation: off?.lastRoundValuation ?? null,
        totalShares: off?.totalShares ?? null,
        // Eight closes: enough for a 24h and a 7d change and a week's sparkline.
        history: (histories.get(company.slug)?.series ?? []).slice(-8).map((point) => point.close),
        series: histories.get(company.slug)?.series ?? [],
        seriesMarket: histories.get(company.slug)?.seriesMarket ?? null,
        issuers: issuers[company.slug] ?? [],
      };
    }),
  };
}
