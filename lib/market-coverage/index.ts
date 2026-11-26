import { cached } from "@/lib/cache";
import { COVERAGE_COMPANIES, collectQuotes, type CoverageQuote, type FetchJson } from "./venues";
import { dailyCloses, type DailyClose } from "./candles";

/**
 * Every market that trades one of the covered companies, read straight from
 * the venues' public APIs.
 *
 * The collectors in this folder are the market data API's market coverage
 * readers, copied unchanged apart from the company list. The API runs them on
 * a ten-minute job and stores the result; this site has no database of its
 * own, so it runs them on demand and holds the result in the shared cache for
 * the same ten minutes. A request inside that window never touches a venue.
 */

export type { CoverageQuote } from "./venues";
export type { DailyClose } from "./candles";

export interface CoverageMarket extends CoverageQuote {
  /** When this market was read. */
  capturedAt: string;
  /** 30-day volume at the market's taker rate: an upper bound on fees paid. */
  estFees30dUsd: number | null;
}

export interface CoverageTotals {
  volume24hUsd: number;
  volume30dUsd: number;
  openInterestUsd: number;
  estFees30dUsd: number;
}

export interface CoverageCompanySnapshot {
  slug: string;
  name: string;
  markets: CoverageMarket[];
  totals: CoverageTotals;
}

export interface CoverageSnapshot {
  updatedAt: string;
  companies: CoverageCompanySnapshot[];
  /** Sources that failed on the last read. Their markets are missing, not zero. */
  failedSources: number;
}

/**
 * One minute, so the pages' one-minute refresh sees new prices. Each read
 * touches every venue once per minute per cache, not per visitor.
 */
const TTL_SECONDS = 60;
/** Gate's and MEXC's contract lists run to a megabyte or two. */
const SOURCE_TIMEOUT_MS = 25_000;

/** GET, or POST with a JSON body for Hyperliquid's info endpoint. */
const fetchJson: FetchJson = async (url, body) => {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Accept: "application/json",
      // A named client rather than the runtime's default, which bot filters
      // in front of some venues are quicker to refuse.
      "User-Agent": "markets-coverage/1.0",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) { throw new Error(`${new URL(url).host} returned ${response.status}`); }
  return response.json();
};

const sum = (markets: CoverageMarket[], pick: (market: CoverageMarket) => number | null) =>
  markets.reduce((total, market) => total + (pick(market) ?? 0), 0);

export function buildSnapshot(quotes: CoverageQuote[], capturedAt: string, failedSources: number): CoverageSnapshot {
  const markets: CoverageMarket[] = quotes.map((quote) => ({
    ...quote,
    capturedAt,
    estFees30dUsd: quote.volume30dUsd === null ? null : (quote.volume30dUsd * quote.feeRateBps) / 10_000,
  }));
  return {
    updatedAt: capturedAt,
    failedSources,
    companies: COVERAGE_COMPANIES.map((company) => {
      const own = markets
        .filter((market) => market.companySlug === company.slug)
        .sort((a, b) => (b.volume30dUsd ?? b.volume24hUsd ?? 0) - (a.volume30dUsd ?? a.volume24hUsd ?? 0));
      return {
        slug: company.slug,
        name: company.name,
        markets: own,
        totals: {
          volume24hUsd: sum(own, (market) => market.volume24hUsd),
          volume30dUsd: sum(own, (market) => market.volume30dUsd),
          openInterestUsd: sum(own, (market) => market.openInterestUsd),
          estFees30dUsd: sum(own, (market) => market.estFees30dUsd),
        },
      };
    }),
  };
}

/**
 * The current snapshot. A run where every source failed throws, so the cache
 * serves its stale copy rather than storing an empty market as the truth.
 */
export function marketCoverage(): Promise<CoverageSnapshot> {
  return cached("market-coverage:v2", TTL_SECONDS, async () => {
    const { quotes, errors } = await collectQuotes(fetchJson);
    if (!quotes.length) {
      throw new Error(`Market coverage found no markets${errors.length ? ` (${errors.length} sources failed)` : ""}`);
    }
    if (errors.length) { console.warn(`[market-coverage] ${errors.length} sources failed: ${errors.join("; ")}`); }
    return buildSnapshot(quotes, new Date().toISOString(), errors.length);
  });
}

/** How far back a company's price history reaches. */
export const HISTORY_DAYS = 90;

/**
 * Daily closes for one market, cached for half an hour: a daily candle only
 * changes its last point, and the change columns read days, not minutes.
 */
export function marketHistory(market: CoverageQuote): Promise<DailyClose[]> {
  return cached(`market-history:v3:${market.venue}:${market.marketType}:${market.market}`, 30 * 60, () => dailyCloses(fetchJson, market, HISTORY_DAYS));
}
