/**
 * Every market that trades one of the companies we issue a token against:
 * Hyperliquid (its own book, each HIP-3 builder's book, and spot) and the
 * centralised exchanges in `market-coverage.exchanges.ts`, read straight from
 * each venue's public API.
 *
 * Markets are discovered on every run rather than listed here. A company is
 * offered by several providers at once -- on Hyperliquid each HIP-3 builder
 * (EntropyIO, Paragon, XYZ, ...) runs its own perp book, and spot tokens are
 * issued by whoever deployed them -- and new ones appear without notice. A
 * fixed list would quietly miss the next provider; scanning every book for the
 * company's name picks it up on the next run.
 */

import {
  BINANCE_STYLE_VENUES,
  binanceStyleQuotes,
  bitgetQuotes,
  gatePerpQuotes,
  gateSpotQuotes,
  kucoinQuotes,
  mexcQuotes,
  okxQuotes,
} from './exchanges';
import {
  asList,
  asRow,
  type CoverageQuote,
  DAY_MS,
  FEE_RATE_BPS,
  type FetchJson,
  HOURS_PER_YEAR,
  matchCompany,
  num,
  times,
  WINDOW_DAYS,
} from './shared';

export * from './exchanges';
export * from './shared';

/* ------------------------------------------------------------------ */
/* Hyperliquid                                                         */
/* ------------------------------------------------------------------ */

const HL_INFO = 'https://api.hyperliquid.xyz/info';

interface Book { dex: string | null; provider: string }

/** Every perp book: Hyperliquid's own, then each HIP-3 builder's. */
async function hyperliquidBooks(fetchJson: FetchJson): Promise<Book[]> {
  const dexes = asList(await fetchJson(HL_INFO, { type: 'perpDexs' }));
  return [
    { dex: null, provider: 'Hyperliquid' },
    ...dexes.flatMap((entry) => {
      const row = asRow(entry);
      const name = typeof row.name === 'string' ? row.name : '';
      if (!name) { return []; }
      return [{ dex: name, provider: typeof row.fullName === 'string' && row.fullName ? row.fullName : name }];
    }),
  ];
}

export function parseHyperliquidPerps(book: Book, body: unknown): CoverageQuote[] {
  const [metaRaw, ctxsRaw] = asList(body);
  const universe = asList(asRow(metaRaw).universe).map(asRow);
  const ctxs = asList(ctxsRaw).map(asRow);

  return universe.flatMap((market, index) => {
    if (market.isDelisted === true) { return []; }
    const name = typeof market.name === 'string' ? market.name : '';
    // Builder markets are named `dex:COIN`; the coin is what identifies the company.
    const base = book.dex && name.startsWith(`${book.dex}:`) ? name.slice(book.dex.length + 1) : name;
    const company = matchCompany(base, book.dex !== null);
    if (!company) { return []; }

    const ctx = ctxs[index] ?? {};
    const price = num(ctx.markPx);
    const funding = num(ctx.funding);
    return [{
      companySlug: company.slug,
      venue: 'hyperliquid' as const,
      marketType: 'perp' as const,
      market: name,
      label: name,
      provider: book.provider,
      dex: book.dex,
      quoteAsset: 'USDC',
      price,
      volume24hUsd: num(ctx.dayNtlVlm),
      volume30dUsd: null,
      // Open interest is in coins; funding is paid hourly.
      openInterestUsd: times(num(ctx.openInterest), price),
      fundingRateAnnualized: funding === null ? null : funding * HOURS_PER_YEAR,
      feeRateBps: FEE_RATE_BPS.hyperliquid.perp,
      tradeUrl: `https://app.hyperliquid.xyz/trade/${encodeURIComponent(name)}`,
    }];
  });
}

export function parseHyperliquidSpot(body: unknown): CoverageQuote[] {
  const [metaRaw, ctxsRaw] = asList(body);
  const meta = asRow(metaRaw);
  const tokens = new Map(asList(meta.tokens).map(asRow).map((token) => [num(token.index), token]));
  const ctxs = new Map(asList(ctxsRaw).map(asRow).map((ctx) => [String(ctx.coin ?? ''), ctx]));

  return asList(meta.universe).map(asRow).flatMap((pair) => {
    const [baseIndex, quoteIndex] = asList(pair.tokens).map(num);
    const base = tokens.get(baseIndex ?? -1);
    const quote = tokens.get(quoteIndex ?? -1);
    if (!base || !quote) { return []; }
    const baseName = String(base.name ?? '');
    const quoteName = String(quote.name ?? '');
    const fullName = typeof base.fullName === 'string' ? base.fullName : '';
    // Spot tickers are capped at a few letters, so the issuer's full name is
    // often the only place the company appears.
    const company = matchCompany(baseName, false) ?? matchCompany(fullName, false);
    if (!company) { return []; }

    const coin = String(pair.name ?? '');
    const ctx = ctxs.get(coin) ?? {};
    return [{
      companySlug: company.slug,
      venue: 'hyperliquid' as const,
      marketType: 'spot' as const,
      market: coin,
      label: `${baseName}/${quoteName}`,
      provider: fullName || baseName,
      dex: null,
      quoteAsset: quoteName || null,
      price: num(ctx.markPx),
      volume24hUsd: num(ctx.dayNtlVlm),
      volume30dUsd: null,
      openInterestUsd: null,
      fundingRateAnnualized: null,
      feeRateBps: FEE_RATE_BPS.hyperliquid.spot,
      tradeUrl: `https://app.hyperliquid.xyz/trade/${encodeURIComponent(baseName)}/${encodeURIComponent(quoteName)}`,
    }];
  });
}

/** Daily candles carry volume in coins, so each day is valued at its own close. */
async function hyperliquidVolume30d(fetchJson: FetchJson, coin: string, now: number): Promise<number | null> {
  const candles = asList(await fetchJson(HL_INFO, {
    type: 'candleSnapshot',
    req: { coin, interval: '1d', startTime: now - WINDOW_DAYS * DAY_MS, endTime: now },
  })).map(asRow);
  if (!candles.length) { return null; }
  return candles.reduce((sum, candle) => sum + (times(num(candle.v), num(candle.c)) ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/* Everything                                                          */
/* ------------------------------------------------------------------ */

export interface CollectResult {
  quotes: CoverageQuote[];
  /** One line per source that failed. The rest of the run still counts. */
  errors: string[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Reads every source, each settled on its own so one venue being down costs
 * only its own rows.
 */
export async function collectQuotes(fetchJson: FetchJson, now = Date.now()): Promise<CollectResult> {
  const errors: string[] = [];
  const quotes: CoverageQuote[] = [];

  const settle = async (label: string, work: () => Promise<CoverageQuote[]>) => {
    try {
      quotes.push(...(await work()));
    } catch (error) {
      errors.push(`${label}: ${message(error)}`);
    }
  };

  let books: Book[] = [{ dex: null, provider: 'Hyperliquid' }];
  try {
    books = await hyperliquidBooks(fetchJson);
  } catch (error) {
    errors.push(`hyperliquid perpDexs: ${message(error)}`);
  }

  await Promise.all([
    ...books.map((book) =>
      settle(`hyperliquid perp ${book.dex ?? 'main'}`, async () =>
        parseHyperliquidPerps(book, await fetchJson(HL_INFO, { type: 'metaAndAssetCtxs', ...(book.dex ? { dex: book.dex } : {}) })),
      ),
    ),
    settle('hyperliquid spot', async () => parseHyperliquidSpot(await fetchJson(HL_INFO, { type: 'spotMetaAndAssetCtxs' }))),
    ...BINANCE_STYLE_VENUES.map((venue) =>
      settle(`${venue.venue} ${venue.marketType}`, () => binanceStyleQuotes(fetchJson, venue)),
    ),
    settle('okx swap', () => okxQuotes(fetchJson, 'SWAP')),
    settle('okx futures', () => okxQuotes(fetchJson, 'FUTURES')),
    settle('mexc perp', () => mexcQuotes(fetchJson, now)),
    settle('bitget perp', () => bitgetQuotes(fetchJson)),
    settle('kucoin perp', () => kucoinQuotes(fetchJson, now)),
    settle('gate perp', () => gatePerpQuotes(fetchJson)),
    settle('gate spot', () => gateSpotQuotes(fetchJson)),
  ]);

  // Only the markets that matched, so a handful of candle requests rather than
  // one per listed coin.
  await Promise.all(
    quotes
      .filter((quote) => quote.venue === 'hyperliquid')
      .map(async (quote) => {
        try {
          quote.volume30dUsd = await hyperliquidVolume30d(fetchJson, quote.market, now);
        } catch (error) {
          errors.push(`hyperliquid candles ${quote.market}: ${message(error)}`);
        }
      }),
  );

  return { quotes, errors };
}
