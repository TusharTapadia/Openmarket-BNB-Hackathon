/** Perpetual market data must be supplied by a connected venue feed. */
export type Perp = {
  company: string; slug: string; exchangeName: string; exchangeType: "CEX" | "DEX"; platformSlug: string;
  /** The venue's own quote, shown in the table so it matches the exchange. */
  price: number;
  /** The same quote in one-share terms; equal to `price` at almost every venue. */
  normalizedPrice: number; priceScale: number;
  /** When the venue was last read. Null means never, or at an unknown time. */
  quotedAt: string | null;
  estimatedValuation: number; openInterest: number | null; volume: number; annualizedFundingRate: number; tradeUrl: string;
};
/**
 * Price at which half the traded volume sits below. Mirrors the midpoint used
 * for the sidebar reference price so the two headline numbers agree.
 */
function weightedMedianPrice(rows: Perp[]): number | null {
  const priced = rows.filter((row) => row.normalizedPrice > 0 && row.volume > 0);
  if (!priced.length) return null;
  const sorted = [...priced].sort((a, b) => a.normalizedPrice - b.normalizedPrice);
  const half = sorted.reduce((sum, row) => sum + row.volume, 0) / 2;
  let running = 0;
  for (const row of sorted) {
    running += row.volume;
    if (running >= half) return row.normalizedPrice;
  }
  return sorted[sorted.length - 1].normalizedPrice;
}

/** See lib/company-data.ts: beyond this a venue is quoting a different unit. */
const PRICE_TOLERANCE = 0.25;

export function perpConsensus(rows: Perp[]) {
  if (!rows.length) return { volume: null, openInterest: null, price: null, venues: 0, excluded: 0 };
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const published = rows.filter((row) => row.openInterest !== null);
  // Open interest and volume stay across every listed venue -- they are totals
  // of what is actually on the table. Only the price average drops the venues
  // whose contract size makes their quote incomparable.
  // Counted off the venues that can actually weight a price -- a venue with no
  // volume contributes nothing and must not inflate the "across N venues" line,
  // which is the same set the sidebar reference price reports.
  const traded = rows.filter((row) => row.normalizedPrice > 0 && row.volume > 0);
  const midpoint = weightedMedianPrice(rows);
  const quoted = midpoint === null ? traded : traded.filter((row) => Math.abs(row.normalizedPrice - midpoint) <= midpoint * PRICE_TOLERANCE);
  const quotedVolume = quoted.reduce((sum, row) => sum + row.volume, 0);
  return {
    volume,
    openInterest: published.length ? published.reduce((sum, row) => sum + (row.openInterest ?? 0), 0) : null,
    price: quotedVolume > 0 ? quoted.reduce((sum, row) => sum + row.normalizedPrice * row.volume, 0) / quotedVolume : null,
    venues: quoted.length,
    excluded: traded.length - quoted.length,
  };
}

export { formatPrice as formatPerpPrice } from "./data";
export function formatFunding(value: number) { return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`; }

/** Beyond this a quote is old enough that calling it current would mislead. */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * How current a venue's quote is.
 *
 * "unknown" is its own answer rather than being folded into "stale": a row
 * imported before anything recorded timestamps has no age, and claiming it is
 * old would be as much a guess as claiming it is fresh.
 */
export function freshness(quotedAt: string | null): { state: "fresh" | "stale" | "unknown"; label: string } {
  if (!quotedAt) { return { state: "unknown", label: "Not refreshed" }; }
  const at = Date.parse(quotedAt);
  if (!Number.isFinite(at)) { return { state: "unknown", label: "Not refreshed" }; }
  const age = Date.now() - at;
  if (age < 0 || age <= STALE_AFTER_MS) { return { state: "fresh", label: "Updated hourly" }; }
  const hours = Math.floor(age / 3_600_000);
  if (hours < 48) { return { state: "stale", label: `${hours}h old` }; }
  return { state: "stale", label: `${Math.floor(hours / 24)}d old` };
}

/** What share of the listed venues the ingest is actually keeping current. */
export function venueCoverage(rows: readonly Perp[]): { fresh: number; total: number; staleVolume: number } {
  const total = rows.length;
  const fresh = rows.filter((row) => freshness(row.quotedAt).state === "fresh").length;
  const volume = rows.reduce((sum, row) => sum + row.volume, 0);
  const staleVolume = volume > 0
    ? rows.filter((row) => freshness(row.quotedAt).state !== "fresh").reduce((sum, row) => sum + row.volume, 0) / volume
    : 0;
  return { fresh, total, staleVolume };
}
