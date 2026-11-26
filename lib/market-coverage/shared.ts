/**
 * What every market coverage reader shares: the companies, the quote each
 * venue is turned into, and the small helpers for reading venue JSON.
 *
 * All figures are in US dollars. Venues report open interest in contracts or
 * coins and funding per interval, so readers convert both before returning a
 * quote and nothing later converts again.
 */

export type Venue = 'hyperliquid' | 'aster' | 'binance' | 'okx' | 'mexc' | 'bitget' | 'kucoin' | 'gate';
export type MarketType = 'perp' | 'spot';

export const VENUES: readonly Venue[] = ['hyperliquid', 'aster', 'binance', 'okx', 'mexc', 'bitget', 'kucoin', 'gate'];

export interface CoverageCompany {
  slug: string;
  name: string;
  /** Matched anywhere in a symbol, so `pANTHROPIC`, `ANTHROPICx` and `POLYMARKETSTOCK` all count. */
  names: string[];
  /**
   * Matched exactly, and only on HIP-3 builder books. Those list equities and
   * pre-IPO names, so `ANT` there is Anthropic; on a crypto book or a spot pair
   * the same three letters are someone else's token.
   */
  shortTickers: string[];
}

/**
 * The companies this site covers, in display order. Same matching rules as
 * the market data API's coverage job, limited to the names shown here.
 */
export const COVERAGE_COMPANIES: CoverageCompany[] = [
  { slug: 'anthropic', name: 'Anthropic', names: ['ANTHROPIC'], shortTickers: ['ANTH', 'ANT'] },
  { slug: 'openai', name: 'OpenAI', names: ['OPENAI'], shortTickers: ['OAI'] },
  { slug: 'anduril', name: 'Anduril', names: ['ANDURIL'], shortTickers: [] },
  { slug: 'neuralink', name: 'Neuralink', names: ['NEURALINK'], shortTickers: [] },
  // Added for the wider watchlist. Full names only: no short tickers, so a
  // crypto token sharing a few letters cannot be taken for one of these.
  { slug: 'databricks', name: 'Databricks', names: ['DATABRICKS'], shortTickers: [] },
  { slug: 'figure-ai', name: 'Figure AI', names: ['FIGUREAI'], shortTickers: [] },
  { slug: 'kalshi', name: 'Kalshi', names: ['KALSHI'], shortTickers: [] },
  { slug: 'polymarket', name: 'Polymarket', names: ['POLYMARKET'], shortTickers: [] },
  { slug: 'oura', name: 'Oura', names: ['OURARING', 'OURA'], shortTickers: [] },
];

/**
 * Base-tier taker fee in basis points, for venues that do not publish a rate
 * per market. MEXC, Bitget, KuCoin and Gate do, and their own rate is used.
 *
 * Fees are estimated from volume at this rate, which assumes every trade paid
 * the base taker fee, so the estimate is an upper bound: maker fills, volume
 * tiers and rebates all pay less. HIP-3 builders also set their own fee scale
 * on top of Hyperliquid's, which this does not model.
 */
export const FEE_RATE_BPS = {
  hyperliquid: { perp: 4.5, spot: 7 },
  aster: { perp: 3.5, spot: 10 },
  binance: { perp: 5 },
  okx: { perp: 5 },
  mexc: { perp: 2 },
} as const;

export interface CoverageQuote {
  companySlug: string;
  venue: Venue;
  marketType: MarketType;
  /** The venue's own id for the market: `io:ANTH`, `@142`, `ANTHROPICUSDT`, `ANTHROPIC-USDT-SWAP`. */
  market: string;
  /** What a person would call it: `io:ANTH`, `pANTH/USDC`, `ANTHROPICUSDT`. */
  label: string;
  /** Who runs the book or issued the token. */
  provider: string;
  /** HIP-3 builder dex, null everywhere else. */
  dex: string | null;
  quoteAsset: string | null;
  price: number | null;
  volume24hUsd: number | null;
  volume30dUsd: number | null;
  openInterestUsd: number | null;
  fundingRateAnnualized: number | null;
  feeRateBps: number;
  tradeUrl: string;
}

export type FetchJson = (url: string, body?: unknown) => Promise<unknown>;

export type Row = Record<string, unknown>;

export const asRow = (value: unknown): Row => (value && typeof value === 'object' ? (value as Row) : {});
export const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') { return null; }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const times = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a * b);

export const HOURS_PER_YEAR = 24 * 365;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WINDOW_DAYS = 30;

/** A funding rate paid every `intervalHours`, as a yearly rate. */
export function annualize(rate: number | null, intervalHours: number | null): number | null {
  if (rate === null || intervalHours === null || intervalHours <= 0) { return null; }
  return rate * (HOURS_PER_YEAR / intervalHours);
}

/** Sums one column of daily candles, or null when there were none. */
export function sumCandles(candles: unknown[], pick: (candle: unknown) => unknown): number | null {
  if (!candles.length) { return null; }
  return candles.reduce<number>((sum, candle) => sum + (num(pick(candle)) ?? 0), 0);
}

/**
 * A rate given as a fraction (0.0006) in basis points, or the fallback when
 * the venue leaves it out. Rounded to a thousandth, since 0.0006 * 10000 is
 * 5.999999999999999 in floating point.
 */
export const bps = (fraction: number | null, fallback: number): number =>
  fraction === null ? fallback : Math.round(fraction * 10_000_000) / 1000;

export function matchCompany(symbol: string, allowShortTickers: boolean): CoverageCompany | null {
  const upper = symbol.trim().toUpperCase();
  if (!upper) { return null; }
  for (const company of COVERAGE_COMPANIES) {
    if (company.names.some((name) => upper.includes(name))) { return company; }
    if (allowShortTickers && company.shortTickers.includes(upper)) { return company; }
  }
  return null;
}
