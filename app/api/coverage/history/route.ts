import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { marketCoverage, marketHistory, type DailyClose } from "@/lib/market-coverage";
import type { MarketType, Venue } from "@/lib/market-coverage/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily candles (close and USD volume) for every covered market, for the Pro
 * charts that need history across all markets rather than each company's lead.
 *
 * Each market's candles are cached for half an hour underneath; this holds
 * the assembled payload for ten minutes. A market whose venue fails to answer
 * comes back with no points, which the charts treat as missing, not zero.
 */
export interface MarketHistory {
  companySlug: string;
  venue: Venue;
  marketType: MarketType;
  market: string;
  label: string;
  provider: string;
  points: DailyClose[];
}

export interface HistoryPayload {
  fetchedAt: string;
  updatedAt: string;
  markets: MarketHistory[];
}

const PAYLOAD_TTL_SECONDS = 10 * 60;

export async function GET() {
  try {
    return NextResponse.json(await cached("route:coverage-history:v1", PAYLOAD_TTL_SECONDS, build), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ message: "Market history is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

async function build(): Promise<HistoryPayload> {
  const coverage = await marketCoverage();
  const markets = await Promise.all(coverage.companies.flatMap((company) => company.markets).map(async (market): Promise<MarketHistory> => ({
    companySlug: market.companySlug,
    venue: market.venue,
    marketType: market.marketType,
    market: market.market,
    label: market.label,
    provider: market.provider,
    points: await marketHistory(market).catch(() => []),
  })));
  return { fetchedAt: new Date().toISOString(), updatedAt: coverage.updatedAt, markets };
}
