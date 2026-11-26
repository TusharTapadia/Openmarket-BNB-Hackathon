import { binanceFapiBase } from "./exchanges";
import { asList, asRow, DAY_MS, type CoverageQuote, type FetchJson, num } from "./shared";

/**
 * Daily closes for one market, oldest first.
 *
 * Read from the same public endpoints the coverage collectors use for 30-day
 * volume; those only keep the volume column, this keeps the close. Used for a
 * company's price history, drawn from its most-traded market.
 */
export interface DailyClose {
  at: string;
  close: number;
  /**
   * That day's traded value in USD, from the candle's quote-volume column.
   * Hyperliquid candles carry base volume only, so there it is base volume
   * times the day's close. Null where a venue's candle has no usable column.
   */
  volumeUsd?: number | null;
}

const HL_INFO = "https://api.hyperliquid.xyz/info";
const OKX = "https://www.okx.com/api/v5";
const MEXC_FUTURES = "https://contract.mexc.com/api/v1/contract";
const BITGET = "https://api.bitget.com/api/v2/mix/market";
const KUCOIN = "https://api-futures.kucoin.com/api/v1";
const GATE = "https://api.gateio.ws/api/v4";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Venues answer in seconds or milliseconds; anything below 1e12 is seconds. */
const toMs = (value: number) => (value < 1e12 ? value * 1000 : value);

function points(rows: Array<[unknown, unknown, unknown?]>): DailyClose[] {
  const byDay = new Map<string, DailyClose>();
  for (const [time, close, volume] of rows) {
    const t = num(time);
    const c = num(close);
    if (t === null || c === null || c <= 0) { continue; }
    const v = num(volume);
    const at = day(toMs(t));
    byDay.set(at, { at, close: c, volumeUsd: v !== null && v >= 0 ? v : null });
  }
  return [...byDay.values()].sort((a, b) => a.at.localeCompare(b.at));
}

export async function dailyCloses(fetchJson: FetchJson, market: CoverageQuote, days: number, now = Date.now()): Promise<DailyClose[]> {
  const start = now - days * DAY_MS;
  const symbol = market.market;
  switch (market.venue) {
    case "hyperliquid": {
      const body = await fetchJson(HL_INFO, { type: "candleSnapshot", req: { coin: symbol, interval: "1d", startTime: start, endTime: now } });
      return points(asList(body).map(asRow).map((row) => { const c = num(row.c); const v = num(row.v); return [row.t, row.c, c !== null && v !== null ? c * v : null]; }));
    }
    case "aster":
    case "binance": {
      const base = market.venue === "binance" ? binanceFapiBase()
        : market.marketType === "spot" ? "https://sapi.asterdex.com/api/v1" : "https://fapi.asterdex.com/fapi/v1";
      const body = await fetchJson(`${base}/klines?symbol=${symbol}&interval=1d&limit=${days}`);
      return points(asList(body).map((row) => { const k = asList(row); return [k[0], k[4], k[7]]; }));
    }
    case "okx": {
      const body = asRow(await fetchJson(`${OKX}/market/candles?instId=${symbol}&bar=1Dutc&limit=${days}`));
      // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
      return points(asList(body.data).map((row) => { const k = asList(row); return [k[0], k[4], k[7]]; }));
    }
    case "mexc": {
      const body = asRow(asRow(await fetchJson(`${MEXC_FUTURES}/kline/${symbol}?interval=Day1&start=${Math.floor(start / 1000)}&end=${Math.floor(now / 1000)}`)).data);
      const times = asList(body.time);
      const closes = asList(body.close);
      // `amount` is turnover in the quote currency.
      const amounts = asList(body.amount);
      return points(times.map((time, index) => [time, closes[index], amounts[index]]));
    }
    case "bitget": {
      const body = asRow(await fetchJson(`${BITGET}/candles?productType=USDT-FUTURES&symbol=${symbol}&granularity=1D&limit=${days}`));
      // [ts, o, h, l, c, baseVolume, quoteVolume]
      return points(asList(body.data).map((row) => { const k = asList(row); return [k[0], k[4], k[6]]; }));
    }
    case "kucoin": {
      const body = asRow(await fetchJson(`${KUCOIN}/kline/query?symbol=${symbol}&granularity=1440&from=${start}&to=${now}`));
      // [time, o, h, l, c, volume (lots), turnover]; older responses stop at volume.
      return points(asList(body.data).map((row) => { const k = asList(row); return [k[0], k[4], k[6]]; }));
    }
    case "gate": {
      if (market.marketType === "spot") {
        const body = await fetchJson(`${GATE}/spot/candlesticks?currency_pair=${symbol}&interval=1d&limit=${days}`);
        // Spot candles: [time, quote volume, close, high, low, open, ...].
        return points(asList(body).map((row) => { const k = asList(row); return [k[0], k[2], k[1]]; }));
      }
      const body = await fetchJson(`${GATE}/futures/usdt/candlesticks?contract=${symbol}&interval=1d&limit=${days}`);
      // `sum` is the day's volume in the quote currency.
      return points(asList(body).map(asRow).map((row) => [row.t, row.c, row.sum]));
    }
  }
}
