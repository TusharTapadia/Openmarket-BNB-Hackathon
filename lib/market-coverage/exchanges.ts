/**
 * Centralised exchanges that list our companies: Aster, Binance, OKX, MEXC,
 * Bitget, KuCoin and Gate.
 *
 * Each reader lists the exchange's instruments, keeps the ones whose base
 * asset names one of the companies, and reads price, volume, open interest and
 * funding for those alone. Listings are discovered every run, so a company an
 * exchange adds tomorrow shows up without a change here.
 *
 * Only perpetuals are read, except on Aster and Gate, which also list spot
 * pairs for these companies. The other exchanges list none, and their spot
 * symbol lists run to megabytes.
 */

import {
  annualize,
  asList,
  asRow,
  bps,
  type CoverageCompany,
  type CoverageQuote,
  DAY_MS,
  FEE_RATE_BPS,
  type FetchJson,
  type MarketType,
  matchCompany,
  num,
  type Row,
  sumCandles,
  times,
  WINDOW_DAYS,
} from './shared';

const empty = (): Row => ({});

/* ------------------------------------------------------------------ */
/* Binance-style APIs: Aster, Binance                                  */
/* ------------------------------------------------------------------ */

/**
 * Aster copies Binance's API, so one reader serves both. A perp venue adds
 * the futures-only reads: mark price, funding and open interest.
 */
export interface BinanceStyleVenue {
  venue: 'aster' | 'binance';
  marketType: MarketType;
  provider: string;
  base: string;
  feeRateBps: number;
  tradeUrl: (symbol: string) => string;
}

export interface BinanceStyleListing {
  symbol: string;
  quoteAsset: string | null;
  company: CoverageCompany;
}

/**
 * Binance answers 451 -- "unavailable for legal reasons" -- to every call from
 * a restricted jurisdiction, market data included, and this API runs in
 * Render's Oregon region. Futures have no public mirror the way spot has
 * `data-api.binance.vision`, so the only way to the data is to call from
 * somewhere Binance serves.
 *
 * `BINANCE_FAPI_BASE` points the reader at a proxy in such a region; see
 * `docs/binance-fapi-proxy.md`. Unset, it calls Binance directly, which is
 * what works in development and from any unrestricted host.
 */
export function binanceFapiBase(configured = process.env.BINANCE_FAPI_BASE): string {
  // Trailing slashes are dropped so `${base}/exchangeInfo` joins either form.
  return (configured?.trim() || 'https://fapi.binance.com/fapi/v1').replace(/\/+$/, '');
}

export const BINANCE_STYLE_VENUES: BinanceStyleVenue[] = [
  {
    venue: 'aster',
    marketType: 'perp',
    provider: 'Aster',
    base: 'https://fapi.asterdex.com/fapi/v1',
    feeRateBps: FEE_RATE_BPS.aster.perp,
    tradeUrl: (symbol) => `https://www.asterdex.com/en/trade/pro/futures/${symbol}`,
  },
  {
    venue: 'aster',
    marketType: 'spot',
    provider: 'Aster',
    base: 'https://sapi.asterdex.com/api/v1',
    feeRateBps: FEE_RATE_BPS.aster.spot,
    tradeUrl: (symbol) => `https://www.asterdex.com/en/trade/pro/spot/${symbol}`,
  },
  {
    venue: 'binance',
    marketType: 'perp',
    provider: 'Binance',
    base: binanceFapiBase(),
    feeRateBps: FEE_RATE_BPS.binance.perp,
    tradeUrl: (symbol) => `https://www.binance.com/en/futures/${symbol}`,
  },
];

/**
 * Symbols that are trading and name one of the companies.
 *
 * Binance lists pre-IPO names as `TRADIFI_PERPETUAL`, not `PERPETUAL`, so any
 * perpetual contract type counts; quarterly contracts do not.
 */
export function parseBinanceStyleSymbols(marketType: MarketType, info: unknown): BinanceStyleListing[] {
  return asList(asRow(info).symbols).map(asRow).flatMap((row) => {
    if (row.status !== 'TRADING') { return []; }
    if (marketType === 'perp' && !String(row.contractType ?? '').includes('PERPETUAL')) { return []; }
    const symbol = String(row.symbol ?? '');
    const company = matchCompany(String(row.baseAsset ?? ''), false);
    if (!symbol || !company) { return []; }
    return [{ symbol, quoteAsset: typeof row.quoteAsset === 'string' ? row.quoteAsset : null, company }];
  });
}

export async function binanceStyleQuotes(fetchJson: FetchJson, venue: BinanceStyleVenue): Promise<CoverageQuote[]> {
  const { base, marketType } = venue;
  const listed = parseBinanceStyleSymbols(marketType, await fetchJson(`${base}/exchangeInfo`));
  if (!listed.length) { return []; }

  const perp = marketType === 'perp';
  const fundingInfo = perp ? await fetchJson(`${base}/fundingInfo`).catch(() => []) : [];
  const intervalOf = new Map(asList(fundingInfo).map(asRow).map((row) => [String(row.symbol ?? ''), num(row.fundingIntervalHours)]));

  return Promise.all(listed.map(async ({ symbol, quoteAsset, company }) => {
    const [ticker, premium, oi, klines] = await Promise.all([
      fetchJson(`${base}/ticker/24hr?symbol=${symbol}`).then(asRow),
      perp ? fetchJson(`${base}/premiumIndex?symbol=${symbol}`).then(asRow).catch(empty) : empty(),
      perp ? fetchJson(`${base}/openInterest?symbol=${symbol}`).then(asRow).catch(empty) : empty(),
      fetchJson(`${base}/klines?symbol=${symbol}&interval=1d&limit=${WINDOW_DAYS}`).then(asList).catch(() => []),
    ]);
    const price = num(premium.markPrice) ?? num(ticker.lastPrice);

    return {
      companySlug: company.slug,
      venue: venue.venue,
      marketType,
      market: symbol,
      label: symbol,
      provider: venue.provider,
      dex: null,
      quoteAsset,
      price,
      volume24hUsd: num(ticker.quoteVolume),
      // Kline index 7 is quote-asset volume, already in dollars.
      volume30dUsd: sumCandles(klines, (kline) => asList(kline)[7]),
      // Open interest is in coins.
      openInterestUsd: times(num(oi.openInterest), price),
      // The interval is per symbol; 8h is only the venues' default.
      fundingRateAnnualized: perp ? annualize(num(premium.lastFundingRate), intervalOf.get(symbol) ?? 8) : null,
      feeRateBps: venue.feeRateBps,
      tradeUrl: venue.tradeUrl(symbol),
    };
  }));
}

/* ------------------------------------------------------------------ */
/* OKX                                                                 */
/* ------------------------------------------------------------------ */

const OKX = 'https://www.okx.com/api/v5';

/** Perpetual swaps, and OKX's `XPERP` futures: five-year contracts that trade like perps. */
export type OkxInstType = 'SWAP' | 'FUTURES';

/** OKX wraps responses as `{ code, msg, data }`, with code "0" on success. */
function okxData(body: unknown): unknown[] {
  const row = asRow(body);
  if (row.code !== undefined && String(row.code) !== '0') {
    throw new Error(`OKX error ${String(row.code)}${row.msg ? `: ${String(row.msg)}` : ''}`);
  }
  return asList(row.data);
}

const okxFirst = (body: unknown): Row => asRow(okxData(body)[0]);

export interface OkxInstrument {
  instId: string;
  quoteAsset: string | null;
  company: CoverageCompany;
}

/** Live instruments whose base, the first part of the id, is one of the companies. */
export function parseOkxInstruments(body: unknown): OkxInstrument[] {
  return okxData(body).map(asRow).flatMap((row) => {
    if (row.state !== 'live') { return []; }
    // `ANTHROPIC-USDT-SWAP`, `ANTHROPIC-USD_UM_XPERP-310912`.
    const instId = String(row.instId ?? '');
    const company = matchCompany(instId.split('-')[0] ?? '', false);
    if (!instId || !company) { return []; }
    return [{ instId, quoteAsset: typeof row.settleCcy === 'string' && row.settleCcy ? row.settleCcy : null, company }];
  });
}

export async function okxQuotes(fetchJson: FetchJson, instType: OkxInstType): Promise<CoverageQuote[]> {
  const listed = parseOkxInstruments(await fetchJson(`${OKX}/public/instruments?instType=${instType}`));

  return Promise.all(listed.map(async ({ instId, quoteAsset, company }) => {
    const [ticker, mark, oi, funding, candles] = await Promise.all([
      fetchJson(`${OKX}/market/ticker?instId=${instId}`).then(okxFirst),
      fetchJson(`${OKX}/public/mark-price?instType=${instType}&instId=${instId}`).then(okxFirst).catch(empty),
      fetchJson(`${OKX}/public/open-interest?instType=${instType}&instId=${instId}`).then(okxFirst).catch(empty),
      instType === 'SWAP' ? fetchJson(`${OKX}/public/funding-rate?instId=${instId}`).then(okxFirst).catch(empty) : empty(),
      fetchJson(`${OKX}/market/candles?instId=${instId}&bar=1Dutc&limit=${WINDOW_DAYS}`).then(okxData).catch(() => []),
    ]);
    const price = num(mark.markPx) ?? num(ticker.last);
    const intervalMs = (num(funding.nextFundingTime) ?? 0) - (num(funding.fundingTime) ?? 0);

    return {
      companySlug: company.slug,
      venue: 'okx' as const,
      marketType: 'perp' as const,
      market: instId,
      label: instId,
      provider: 'OKX',
      dex: null,
      quoteAsset,
      price,
      // Derivatives count 24h volume in the base asset.
      volume24hUsd: times(num(ticker.volCcy24h), price),
      // Candle index 7 is volume in the quote asset, already in dollars.
      volume30dUsd: sumCandles(candles, (candle) => asList(candle)[7]),
      openInterestUsd: num(oi.oiUsd) ?? times(num(oi.oiCcy), price),
      fundingRateAnnualized: annualize(num(funding.fundingRate), intervalMs > 0 ? intervalMs / 3_600_000 : 8),
      feeRateBps: FEE_RATE_BPS.okx.perp,
      tradeUrl: `https://www.okx.com/${instType === 'SWAP' ? 'trade-swap' : 'trade-futures'}/${instId.toLowerCase()}`,
    };
  }));
}

/* ------------------------------------------------------------------ */
/* MEXC                                                                */
/* ------------------------------------------------------------------ */

const MEXC_FUTURES = 'https://contract.mexc.com/api/v1/contract';

/** MEXC wraps futures responses as `{ success, code, data }`. */
function mexcData(body: unknown): unknown {
  const row = asRow(body);
  if (row.success === false) {
    throw new Error(`MEXC error ${String(row.code)}${row.message ? `: ${String(row.message)}` : ''}`);
  }
  return row.data;
}

export interface MexcContract {
  symbol: string;
  quoteAsset: string | null;
  /** Shares per contract: MEXC trades these names in thousandths. */
  contractSize: number | null;
  takerFeeRate: number | null;
  company: CoverageCompany;
}

/** Live contracts (state 0) whose base coin names one of the companies, e.g. `POLYMARKETSTOCK`. */
export function parseMexcContracts(body: unknown): MexcContract[] {
  return asList(mexcData(body)).map(asRow).flatMap((row) => {
    if (row.state !== 0 || row.isHidden === true) { return []; }
    const symbol = String(row.symbol ?? '');
    const company = matchCompany(String(row.baseCoin ?? ''), false);
    if (!symbol || !company) { return []; }
    return [{
      symbol,
      quoteAsset: typeof row.quoteCoin === 'string' ? row.quoteCoin : null,
      contractSize: num(row.contractSize),
      takerFeeRate: num(row.takerFeeRate),
      company,
    }];
  });
}

export async function mexcQuotes(fetchJson: FetchJson, now: number): Promise<CoverageQuote[]> {
  const listed = parseMexcContracts(await fetchJson(`${MEXC_FUTURES}/detail`));
  const start = Math.floor((now - WINDOW_DAYS * DAY_MS) / 1000);
  const end = Math.floor(now / 1000);

  return Promise.all(listed.map(async (contract) => {
    const { symbol } = contract;
    const [ticker, funding, kline] = await Promise.all([
      fetchJson(`${MEXC_FUTURES}/ticker?symbol=${symbol}`).then(mexcData).then(asRow),
      fetchJson(`${MEXC_FUTURES}/funding_rate/${symbol}`).then(mexcData).then(asRow).catch(empty),
      fetchJson(`${MEXC_FUTURES}/kline/${symbol}?interval=Day1&start=${start}&end=${end}`).then(mexcData).then(asRow).catch(empty),
    ]);
    const price = num(ticker.fairPrice) ?? num(ticker.lastPrice);

    return {
      companySlug: contract.company.slug,
      venue: 'mexc' as const,
      marketType: 'perp' as const,
      market: symbol,
      label: symbol,
      provider: 'MEXC',
      dex: null,
      quoteAsset: contract.quoteAsset,
      price,
      // `amount24` is quote turnover; `volume24` would be contracts.
      volume24hUsd: num(ticker.amount24),
      // `amount` is each day's turnover in the quote asset.
      volume30dUsd: sumCandles(asList(kline.amount), (amount) => amount),
      // Open interest is in contracts, each `contractSize` shares.
      openInterestUsd: times(times(num(ticker.holdVol), contract.contractSize), price),
      fundingRateAnnualized: annualize(num(ticker.fundingRate) ?? num(funding.fundingRate), num(funding.collectCycle) ?? 8),
      feeRateBps: bps(contract.takerFeeRate, FEE_RATE_BPS.mexc.perp),
      tradeUrl: `https://www.mexc.com/futures/${symbol}`,
    };
  }));
}

/* ------------------------------------------------------------------ */
/* Bitget                                                              */
/* ------------------------------------------------------------------ */

const BITGET = 'https://api.bitget.com/api/v2/mix/market';
const BITGET_PRODUCT = 'productType=USDT-FUTURES';

/** Bitget wraps responses as `{ code, msg, data }`, with code "00000" on success. */
function bitgetData(body: unknown): unknown {
  const row = asRow(body);
  if (row.code !== undefined && String(row.code) !== '00000') {
    throw new Error(`Bitget error ${String(row.code)}${row.msg ? `: ${String(row.msg)}` : ''}`);
  }
  return row.data;
}

export interface BitgetContract {
  symbol: string;
  quoteAsset: string | null;
  takerFeeRate: number | null;
  fundingIntervalHours: number | null;
  company: CoverageCompany;
}

/** Perpetuals in normal trading whose base coin names one of the companies. */
export function parseBitgetContracts(body: unknown): BitgetContract[] {
  return asList(bitgetData(body)).map(asRow).flatMap((row) => {
    if (row.symbolStatus !== 'normal' || row.symbolType !== 'perpetual') { return []; }
    const symbol = String(row.symbol ?? '');
    const company = matchCompany(String(row.baseCoin ?? ''), false);
    if (!symbol || !company) { return []; }
    return [{
      symbol,
      quoteAsset: typeof row.quoteCoin === 'string' ? row.quoteCoin : null,
      takerFeeRate: num(row.takerFeeRate),
      fundingIntervalHours: num(row.fundInterval),
      company,
    }];
  });
}

export async function bitgetQuotes(fetchJson: FetchJson): Promise<CoverageQuote[]> {
  const listed = parseBitgetContracts(await fetchJson(`${BITGET}/contracts?${BITGET_PRODUCT}`));

  return Promise.all(listed.map(async (contract) => {
    const { symbol } = contract;
    const [ticker, candles] = await Promise.all([
      fetchJson(`${BITGET}/ticker?${BITGET_PRODUCT}&symbol=${symbol}`).then(bitgetData).then((data) => asRow(asList(data)[0])),
      fetchJson(`${BITGET}/candles?${BITGET_PRODUCT}&symbol=${symbol}&granularity=1D&limit=${WINDOW_DAYS}`)
        .then(bitgetData)
        .then(asList)
        .catch(() => []),
    ]);
    const price = num(ticker.markPrice) ?? num(ticker.lastPr);

    return {
      companySlug: contract.company.slug,
      venue: 'bitget' as const,
      marketType: 'perp' as const,
      market: symbol,
      label: symbol,
      provider: 'Bitget',
      dex: null,
      quoteAsset: contract.quoteAsset,
      price,
      volume24hUsd: num(ticker.usdtVolume) ?? num(ticker.quoteVolume),
      // Candle index 6 is volume in the quote asset.
      volume30dUsd: sumCandles(candles, (candle) => asList(candle)[6]),
      // `holdingAmount` is open interest in the base coin.
      openInterestUsd: times(num(ticker.holdingAmount), price),
      fundingRateAnnualized: annualize(num(ticker.fundingRate), contract.fundingIntervalHours ?? 8),
      feeRateBps: bps(contract.takerFeeRate, 6),
      tradeUrl: `https://www.bitget.com/futures/usdt/${symbol}`,
    };
  }));
}

/* ------------------------------------------------------------------ */
/* KuCoin                                                              */
/* ------------------------------------------------------------------ */

const KUCOIN = 'https://api-futures.kucoin.com/api/v1';

/** KuCoin wraps responses as `{ code, data }`, with code "200000" on success. */
function kucoinData(body: unknown): unknown {
  const row = asRow(body);
  if (row.code !== undefined && String(row.code) !== '200000') {
    throw new Error(`KuCoin error ${String(row.code)}${row.msg ? `: ${String(row.msg)}` : ''}`);
  }
  return row.data;
}

/**
 * Open contracts whose base currency names one of the companies. KuCoin's
 * contract list already carries mark price, open interest, turnover and
 * funding, so only the 30-day candles need a second read.
 */
export function parseKucoinContracts(body: unknown): Array<{ row: Row; company: CoverageCompany }> {
  return asList(kucoinData(body)).map(asRow).flatMap((row) => {
    if (row.status !== 'Open') { return []; }
    const company = matchCompany(String(row.baseCurrency ?? ''), false);
    return company && row.symbol ? [{ row, company }] : [];
  });
}

export async function kucoinQuotes(fetchJson: FetchJson, now: number): Promise<CoverageQuote[]> {
  const listed = parseKucoinContracts(await fetchJson(`${KUCOIN}/contracts/active`));

  return Promise.all(listed.map(async ({ row, company }) => {
    const symbol = String(row.symbol);
    const candles = await fetchJson(
      `${KUCOIN}/kline/query?symbol=${symbol}&granularity=1440&from=${now - WINDOW_DAYS * DAY_MS}&to=${now}`,
    ).then(kucoinData).then(asList).catch(() => []);
    const price = num(row.markPrice) ?? num(row.lastTradePrice);
    const intervalMs = num(row.currentFundingRateGranularity) ?? num(row.fundingRateGranularity);

    return {
      companySlug: company.slug,
      venue: 'kucoin' as const,
      marketType: 'perp' as const,
      market: symbol,
      label: symbol,
      provider: 'KuCoin',
      dex: null,
      quoteAsset: typeof row.quoteCurrency === 'string' ? row.quoteCurrency : null,
      price,
      // `turnoverOf24h` is in the quote asset; `volumeOf24h` would be coins.
      volume24hUsd: num(row.turnoverOf24h),
      // Candle index 6 is turnover in the quote asset.
      volume30dUsd: sumCandles(candles, (candle) => asList(candle)[6]),
      // Open interest is in contracts, each `multiplier` shares.
      openInterestUsd: times(times(num(row.openInterest), num(row.multiplier)), price),
      fundingRateAnnualized: annualize(num(row.fundingFeeRate), intervalMs === null ? 8 : intervalMs / 3_600_000),
      feeRateBps: bps(num(row.takerFeeRate), 6),
      tradeUrl: `https://www.kucoin.com/futures/trade/${symbol}`,
    };
  }));
}

/* ------------------------------------------------------------------ */
/* Gate                                                                */
/* ------------------------------------------------------------------ */

const GATE = 'https://api.gateio.ws/api/v4';

/**
 * Tickers whose contract names one of the companies, e.g. `NEURALINK_USDT`.
 *
 * Listed from tickers rather than contracts: the contract list is well over a
 * megabyte, the ticker list a third of that. Each match's contract is read on
 * its own for status, size and fee.
 */
export function parseGateTickers(body: unknown): Array<{ ticker: Row; company: CoverageCompany }> {
  return asList(body).map(asRow).flatMap((ticker) => {
    const company = matchCompany(String(ticker.contract ?? '').split('_')[0] ?? '', false);
    return company ? [{ ticker, company }] : [];
  });
}

export async function gatePerpQuotes(fetchJson: FetchJson): Promise<CoverageQuote[]> {
  const listed = parseGateTickers(await fetchJson(`${GATE}/futures/usdt/tickers`));

  const quotes = await Promise.all(listed.map(async ({ ticker, company }): Promise<CoverageQuote | null> => {
    const name = String(ticker.contract);
    const [contract, candles] = await Promise.all([
      fetchJson(`${GATE}/futures/usdt/contracts/${name}`).then(asRow),
      fetchJson(`${GATE}/futures/usdt/candlesticks?contract=${name}&interval=1d&limit=${WINDOW_DAYS}`).then(asList).catch(() => []),
    ]);
    if (contract.status !== 'trading' || contract.in_delisting === true) { return null; }
    const price = num(ticker.mark_price) ?? num(contract.mark_price) ?? num(ticker.last);
    const intervalSeconds = num(contract.funding_interval);

    return {
      companySlug: company.slug,
      venue: 'gate',
      marketType: 'perp',
      market: name,
      label: name,
      provider: 'Gate',
      dex: null,
      quoteAsset: 'USDT',
      price,
      volume24hUsd: num(ticker.volume_24h_quote),
      // `sum` is each day's turnover in the quote asset.
      volume30dUsd: sumCandles(candles, (candle) => asRow(candle).sum),
      // `position_size` is the long side in contracts, each `quanto_multiplier`
      // shares. The ticker's `total_size` counts both sides, twice the usual figure.
      openInterestUsd: times(times(num(contract.position_size), num(contract.quanto_multiplier)), price),
      fundingRateAnnualized: annualize(
        num(ticker.funding_rate) ?? num(contract.funding_rate),
        intervalSeconds === null ? 8 : intervalSeconds / 3600,
      ),
      feeRateBps: bps(num(contract.taker_fee_rate), 7.5),
      tradeUrl: `https://www.gate.com/futures/USDT/${name}`,
    };
  }));
  return quotes.filter((quote): quote is CoverageQuote => quote !== null);
}

/** Leveraged tokens such as `OPENAI3L` and `OPENAI5S` track the price, they are not it. */
const LEVERAGED_TOKEN = /\d+[LS]$/;

/** Tradable spot pairs whose base names one of the companies, without leveraged tokens. */
export function parseGatePairs(body: unknown): Array<{ row: Row; company: CoverageCompany }> {
  return asList(body).map(asRow).flatMap((row) => {
    const base = String(row.base ?? '');
    if (row.trade_status !== 'tradable' || LEVERAGED_TOKEN.test(base)) { return []; }
    const company = matchCompany(base, false);
    return company ? [{ row, company }] : [];
  });
}

export async function gateSpotQuotes(fetchJson: FetchJson): Promise<CoverageQuote[]> {
  const listed = parseGatePairs(await fetchJson(`${GATE}/spot/currency_pairs`));

  return Promise.all(listed.map(async ({ row, company }) => {
    const id = String(row.id);
    const [ticker, candles] = await Promise.all([
      fetchJson(`${GATE}/spot/tickers?currency_pair=${id}`).then((body) => asRow(asList(body)[0])),
      fetchJson(`${GATE}/spot/candlesticks?currency_pair=${id}&interval=1d&limit=${WINDOW_DAYS}`).then(asList).catch(() => []),
    ]);
    // The pair's fee is a percentage: "0.2" is 0.2%, 20 bps.
    const feePercent = num(row.fee);

    return {
      companySlug: company.slug,
      venue: 'gate' as const,
      marketType: 'spot' as const,
      market: id,
      label: id.replace('_', '/'),
      provider: 'Gate',
      dex: null,
      quoteAsset: typeof row.quote === 'string' ? row.quote : null,
      price: num(ticker.last),
      volume24hUsd: num(ticker.quote_volume),
      // Spot candle index 1 is volume in the quote asset.
      volume30dUsd: sumCandles(candles, (candle) => asList(candle)[1]),
      openInterestUsd: null,
      fundingRateAnnualized: null,
      feeRateBps: feePercent === null ? 20 : feePercent * 100,
      tradeUrl: typeof row.trade_url === 'string' && row.trade_url ? row.trade_url : `https://www.gate.com/trade/${id}`,
    };
  }));
}
