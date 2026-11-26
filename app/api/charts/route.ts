import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { marketCoverage, marketHistory } from "@/lib/market-coverage";
import { COVERAGE_COMPANIES } from "@/lib/market-coverage/shared";
import { offchainData } from "@/lib/offchain";
import { issuerTokens } from "@/lib/issuers";
import { companyView } from "@/lib/coverage-view";
import { derivedPrice } from "@/lib/derived-price";
import type { CompanyPoint } from "@/lib/market-series";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How far back the charts reach. */
const WINDOW_DAYS = 120;
const PAYLOAD_TTL_SECONDS = 60;

/**
 * Company charts, on the same footing as the rest of the site.
 *
 * - Price now is the weighted price per share (lib/derived-price.ts), the
 *   figure the Data feeds page and the on-chain oracle carry.
 * - Valuation is that price times the company's real share count
 *   (AllocationsX). With no share count, no valuation is drawn.
 * - History is the daily median close of the company's main-basis markets
 *   (the ones quoting the same unit as its lead market), scaled so the last
 *   day equals today's price per share. Only ratios of one series are used,
 *   so it holds whether those markets quote a share or a valuation in
 *   billions; markets on another basis (EntropyIO's 17.6×) never enter it.
 * - Volume is summed across every market the company trades on.
 *
 * The old version averaged venue prices across different units, so a share
 * read as $1,260 and valuations as trillions; this replaces it.
 */
export async function GET() {
  try {
    return NextResponse.json(await cached("route:charts:v2", PAYLOAD_TTL_SECONDS, build), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ message: "Market data is temporarily unavailable. Please try again." }, { status: 502 });
  }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function build() {
  const list = COVERAGE_COMPANIES.map(({ slug, name }) => ({ slug, name }));
  const [coverage, offchain, issuers] = await Promise.all([
    marketCoverage(),
    offchainData(list).catch(() => null),
    issuerTokens().catch(() => ({} as Awaited<ReturnType<typeof issuerTokens>>)),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const companies = await Promise.all(coverage.companies.map(async (company) => {
    const off = offchain?.companies.get(company.slug);
    const view = companyView({
      ...company, sector: off?.sector ?? null, logo: off?.logo ?? null, offchainPrice: off?.price ?? null,
      offchainValuation: off?.marketCap ?? null, offchainValuationBasis: off?.valuationBasis ?? null, lastRoundValuation: off?.lastRoundValuation ?? null,
      totalShares: off?.totalShares ?? null, history: [], series: [], seriesMarket: null, issuers: issuers[company.slug] ?? [],
    });
    const derived = await derivedPrice(company.slug).catch(() => null);
    const shares = off?.totalShares ?? null;
    const price = derived?.price ?? view.impliedSharePrice ?? off?.price ?? null;

    // Daily candles for every market; closes from the main basis only, volume from all.
    const histories = await Promise.all(view.rows.map(async (row) => ({ row, points: await marketHistory(row).catch(() => []) })));
    const mainKeys = new Set(view.main.map((row) => `${row.venue}|${row.marketType}|${row.market}`));
    const closes = new Map<string, number[]>();
    const volumes = new Map<string, number>();
    for (const { row, points } of histories) {
      const isMain = mainKeys.has(`${row.venue}|${row.marketType}|${row.market}`);
      for (const point of points) {
        if (point.at < cutoff) { continue; }
        if (isMain && point.close > 0) { closes.set(point.at, [...(closes.get(point.at) ?? []), point.close]); }
        if (point.volumeUsd) { volumes.set(point.at, (volumes.get(point.at) ?? 0) + point.volumeUsd); }
      }
    }
    const days = [...closes.keys()].sort();
    const latestClose = days.length ? median(closes.get(days[days.length - 1])!) : null;
    const scale = price !== null && latestClose ? price / latestClose : null;
    const first = days.length ? median(closes.get(days[0])!) : null;
    const points: CompanyPoint[] = scale === null ? [] : days.map((at) => {
      const close = median(closes.get(at)!);
      const perShare = close * scale;
      return {
        at,
        price: perShare,
        // Today's candle is still in progress, so its volume is partial; keep it out of the volume line's last point.
        volume: at === today ? 0 : volumes.get(at) ?? 0,
        venues: closes.get(at)!.length,
        valuation: shares ? perShare * shares : null,
        index: first ? (close / first) * 100 : 100,
      };
    });

    const volume24h = view.rows.reduce((sum, row) => sum + (row.volume24hUsd ?? 0), 0)
      + view.issuers.reduce((sum, token) => sum + (token.volume24h ?? 0), 0);
    return {
      slug: company.slug,
      name: company.name,
      logo: off?.logo ?? null,
      sector: off?.sector ?? null,
      price,
      /** The off-chain share price, from private-market trades. */
      markPrice: off?.price ?? null,
      shares,
      valuation: price !== null && shares ? price * shares : null,
      round: off?.lastRoundValuation ? `Last priced round ${compactUsd(off.lastRoundValuation)}` : null,
      roundDate: null,
      referenceVenues: derived?.sourcesUsed ?? view.main.length,
      referenceVolume: volume24h || null,
      points,
    };
  }));

  return {
    fetchedAt: new Date().toISOString(),
    companies,
    derivatives: { venueCount: new Set(coverage.companies.flatMap((company) => company.markets.map((market) => market.venue))).size },
    windowDays: WINDOW_DAYS,
  };
}

function compactUsd(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}
