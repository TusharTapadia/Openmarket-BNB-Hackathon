import { cached } from "@/lib/cache";

/**
 * CoinMarketCap's prices for tokenized shares of companies we track, with the
 * exchange markets behind each price.
 *
 * Without a key this reads CoinMarketCap's public web data API, the one its own
 * coin pages use (no account, no user data sent):
 *  - GET api.coinmarketcap.com/data-api/v3/cryptocurrency/quote/latest?id=…
 *  - GET api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest?id=…&category=spot&centerType=all
 *  - GET api.coinmarketcap.com/data-api/v3/cryptocurrency/detail/chart?id=…&range=1D|7D|1M
 * With `CMC_API_KEY` set, quotes and market pairs come from the Pro API
 * (pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest and
 * /v2/cryptocurrency/market-pairs/latest; the second needs a paid plan) and
 * fall back to the public API if the Pro call fails.
 *
 * Only markets CoinMarketCap itself counts are kept: verified (public API),
 * not flagged as a price outlier, not excluded from price or volume, quoted in
 * the last day and with volume. Pairs on one exchange are folded into one row
 * per exchange, volume-weighted.
 */

const PUBLIC = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency";
const PRO = "https://pro-api.coinmarketcap.com/v2/cryptocurrency";
const TIMEOUT_MS = 15_000;
const TTL_SECONDS = 60;
const HISTORY_TTL_SECONDS = 5 * 60;
/** A market not quoted for this long is not a current price. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The tokenized public shares CoinMarketCap tracks for our companies, by CMC
 * id (from CMC's search, checked by hand). Each is one share per token by its
 * issuer's design; `oneShare` marks the ones where that is stated (bStocks by
 * Atlas' share multiplier of 1, xStocks by Backed), the rest are checked
 * against the share price before use. Pre-IPO claims (PreStocks, Republic,
 * Tessera) are left out: after a listing they price a locked share, and CMC's
 * prices for them are stale.
 */
export const CMC_ASSETS: Record<string, CmcAssetRef[]> = {
  anthropic: [
    { id: 42860, cmcSlug: "anthropic-tokenized-bstocks", symbol: "ANTB", name: "Anthropic Tokenized bStocks", issuer: "bStocks", oneShare: true },
    { id: 42885, cmcSlug: "anthropic-tokenized-stock-xstock", symbol: "ANTx", name: "Anthropic tokenized stock (xStock)", issuer: "xStocks", oneShare: true },
    { id: 42896, cmcSlug: "anthropic-robinhood", symbol: "ANT", name: "Anthropic (Robinhood)", issuer: "Robinhood", oneShare: false },
    { id: 42897, cmcSlug: "anthropic-pbc-tokenized-stock-coinbase", symbol: "ANTc", name: "Anthropic PBC Tokenized Stock (Coinbase)", issuer: "Coinbase", oneShare: false },
    { id: 42874, cmcSlug: "anthropic-tokenized-stock-ondo", symbol: "ANTon", name: "Anthropic Tokenized Stock (Ondo)", issuer: "Ondo", oneShare: false },
  ],
  spacex: [
    { id: 40217, cmcSlug: "spacex-tokenized-bstocks", symbol: "SPCXB", name: "SpaceX Tokenized bStocks", issuer: "bStocks", oneShare: true },
    { id: 40218, cmcSlug: "spacex-tokenized-stock-xtock", symbol: "SPCXx", name: "SpaceX tokenized stock (xStock)", issuer: "xStocks", oneShare: true },
    { id: 40238, cmcSlug: "spacex-tokenized-stock-backpack", symbol: "SPCX", name: "SpaceX tokenized stock (Backpack)", issuer: "Backpack", oneShare: false },
    { id: 37068, cmcSlug: "spacex-tokenized-stock-robinhood", symbol: "SPCX", name: "SpaceX Tokenized Stock (Robinhood)", issuer: "Robinhood", oneShare: false },
    { id: 40668, cmcSlug: "spacex-tokenized-stock-reality", symbol: "rSPCX", name: "SpaceX Tokenized Stock (Reality)", issuer: "Reality", oneShare: false },
    { id: 40232, cmcSlug: "spacex-tokenized-stock-ondo", symbol: "SPCXon", name: "SpaceX Tokenized Stock (Ondo)", issuer: "Ondo", oneShare: false },
  ],
};

export interface CmcAssetRef {
  id: number;
  /** coinmarketcap.com/currencies/{cmcSlug}. */
  cmcSlug: string;
  symbol: string;
  name: string;
  /** Who issues the token. */
  issuer: string;
  /** One token is stated to be one share. */
  oneShare: boolean;
}

export interface CmcPair {
  /** CoinMarketCap's market id (the same id Atlas lists its sources under). */
  marketId: string;
  /** "SPCXB/USDT". */
  market: string;
  price: number;
  volume24h: number;
  updatedAt: string;
}

/** One exchange's markets for a token, folded together. */
export interface CmcExchange {
  exchange: string;
  exchangeSlug: string;
  dex: boolean;
  /** Volume-weighted across `pairs`, USD. */
  price: number;
  volume24h: number;
  /** The latest of the pairs' quotes. */
  updatedAt: string;
  pairs: CmcPair[];
}

export interface CmcAsset extends CmcAssetRef {
  /** Our company slug. */
  slug: string;
  /** CoinMarketCap's aggregate price, USD. */
  price: number | null;
  volume24h: number | null;
  updatedAt: string | null;
  /** coinmarketcap.com page. */
  url: string;
  /** By volume, largest first. */
  exchanges: CmcExchange[];
  source: "public" | "pro";
}

export type CmcRange = "1D" | "7D" | "1M";
export interface CmcHistory { id: number; symbol: string; range: CmcRange; points: { t: number; price: number; volume24h: number | null }[] }

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const asList = (value: unknown): Row[] => (Array.isArray(value) ? value.map(asRow) : []);
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") { return null; }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: unknown) => { const parsed = num(value); return parsed !== null && parsed > 0 ? parsed : null; };
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const apiKey = () => process.env.CMC_API_KEY?.trim() || null;

async function getJson(url: string, pro = false): Promise<Row> {
  const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "markets-feeds/1.0" };
  const key = apiKey();
  if (pro && key) { headers["X-CMC_PRO_API_KEY"] = key; }
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) { throw new Error(`${new URL(url).host} returned ${response.status}`); }
  const body = asRow(await response.json());
  const status = asRow(body.status);
  const code = num(status.error_code);
  if (code !== null && code !== 0) { throw new Error(`${new URL(url).host}: ${String(status.error_message ?? code)}`); }
  return body;
}

type RawPair = CmcPair & { exchange: string; exchangeSlug: string; dex: boolean };

function fold(raw: RawPair[]): CmcExchange[] {
  const groups = new Map<string, RawPair[]>();
  for (const pair of raw) { groups.set(pair.exchangeSlug, [...(groups.get(pair.exchangeSlug) ?? []), pair]); }
  return [...groups.values()].map((pairs): CmcExchange => {
    const volume = pairs.reduce((sum, pair) => sum + pair.volume24h, 0);
    return {
      exchange: pairs[0].exchange,
      exchangeSlug: pairs[0].exchangeSlug,
      dex: pairs[0].dex,
      price: pairs.reduce((sum, pair) => sum + pair.price * pair.volume24h, 0) / volume,
      volume24h: volume,
      updatedAt: pairs.map((pair) => pair.updatedAt).sort().pop()!,
      pairs: pairs.map(({ marketId, market, price, volume24h, updatedAt }) => ({ marketId, market, price, volume24h, updatedAt })).sort((a, b) => b.volume24h - a.volume24h),
    };
  }).sort((a, b) => b.volume24h - a.volume24h);
}

const fresh = (iso: string | null, now: number): iso is string => !!iso && now - Date.parse(iso) <= MAX_AGE_MS;

async function publicAsset(ref: CmcAssetRef): Promise<{ price: number | null; volume24h: number | null; updatedAt: string | null; raw: RawPair[] }> {
  const [quote, pairs] = await Promise.all([
    getJson(`${PUBLIC}/quote/latest?id=${ref.id}`).catch(() => null),
    getJson(`${PUBLIC}/market-pairs/latest?id=${ref.id}&start=1&limit=300&category=spot&centerType=all&sort=cmc_rank_advanced&direction=desc&spotUntracked=true`),
  ]);
  const now = Date.now();
  const coin = asList(quote?.data)[0];
  const usd = asList(coin?.quotes)[0];
  const raw = asList(asRow(pairs.data).marketPairs).flatMap((pair): RawPair[] => {
    const price = positive(pair.price);
    const volume = positive(pair.volumeUsd);
    const updatedAt = str(pair.lastUpdated);
    const counted = num(pair.isVerified) === 1 && num(pair.priceExcluded) !== 1 && num(pair.outlierDetected) !== 1 && num(pair.volumeExcluded) !== 1;
    if (!counted || price === null || volume === null || !fresh(updatedAt, now)) { return []; }
    return [{
      marketId: String(pair.marketId ?? ""), market: str(pair.marketPair) ?? `${ref.symbol}/?`, price, volume24h: volume, updatedAt: new Date(updatedAt).toISOString(),
      exchange: str(pair.exchangeName) ?? "Unknown", exchangeSlug: str(pair.exchangeSlug) ?? String(pair.exchangeId ?? "unknown"), dex: pair.centerType === "dex",
    }];
  });
  return { price: positive(usd?.price), volume24h: positive(usd?.volume24h), updatedAt: str(usd?.lastUpdated) ?? str(coin?.lastUpdated), raw };
}

async function proAsset(ref: CmcAssetRef): Promise<{ price: number | null; volume24h: number | null; updatedAt: string | null; raw: RawPair[] }> {
  const [quote, pairs] = await Promise.all([
    getJson(`${PRO}/quotes/latest?id=${ref.id}`, true).catch(() => null),
    getJson(`${PRO}/market-pairs/latest?id=${ref.id}&limit=300&category=spot`, true),
  ]);
  const now = Date.now();
  const usd = asRow(asRow(asRow(asRow(quote?.data)[String(ref.id)]).quote).USD);
  const raw = asList(asRow(pairs.data).market_pairs).flatMap((pair): RawPair[] => {
    const q = asRow(asRow(pair.quote).USD);
    const exchange = asRow(pair.exchange);
    const price = positive(q.price);
    const volume = positive(q.volume_24h);
    const updatedAt = str(q.last_updated);
    if (price === null || volume === null || !fresh(updatedAt, now)) { return []; }
    return [{
      marketId: String(pair.market_id ?? ""), market: str(pair.market_pair) ?? `${ref.symbol}/?`, price, volume24h: volume, updatedAt: new Date(updatedAt).toISOString(),
      exchange: str(exchange.name) ?? "Unknown", exchangeSlug: str(exchange.slug) ?? String(exchange.id ?? "unknown"), dex: pair.category === "dex" || pair.center_type === "dex",
    }];
  });
  return { price: positive(usd.price), volume24h: positive(usd.volume_24h), updatedAt: str(usd.last_updated), raw };
}

/** One tracked token by CMC id, or null when CMC does not answer or it is not in `CMC_ASSETS`. */
export function cmcAsset(id: number): Promise<CmcAsset | null> {
  const entry = Object.entries(CMC_ASSETS).flatMap(([slug, refs]) => refs.map((ref) => ({ slug, ref }))).find((item) => item.ref.id === id);
  if (!entry) { return Promise.resolve(null); }
  const { slug, ref } = entry;
  return cached(`cmc-asset:v1:${id}`, TTL_SECONDS, async () => {
    let source: CmcAsset["source"] = "public";
    let read: Awaited<ReturnType<typeof publicAsset>>;
    if (apiKey()) {
      try { read = await proAsset(ref); source = "pro"; } catch { read = await publicAsset(ref); }
    } else {
      read = await publicAsset(ref);
    }
    return {
      ...ref, slug,
      price: read.price, volume24h: read.volume24h, updatedAt: read.updatedAt,
      url: `https://coinmarketcap.com/currencies/${ref.cmcSlug}/`,
      exchanges: fold(read.raw),
      source,
    } satisfies CmcAsset;
  }).catch((error: unknown) => {
    console.warn(`[cmc] ${ref.symbol} (${id}): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
}

/** Every tracked token for a company that CMC answered for. Read one at a time so a cold read does not burst CMC's public API. */
export async function cmcCompany(slug: string): Promise<CmcAsset[]> {
  const out: CmcAsset[] = [];
  for (const ref of CMC_ASSETS[slug] ?? []) {
    const asset = await cmcAsset(ref.id);
    if (asset) { out.push(asset); }
  }
  return out;
}

/** CMC's price history for a token: 5-minute points over 1D, about 15-minute over 7D, 2-hourly over 1M. Public API only. */
export function cmcHistory(id: number, range: CmcRange = "1D"): Promise<CmcHistory | null> {
  const ref = Object.values(CMC_ASSETS).flat().find((item) => item.id === id);
  if (!ref || !["1D", "7D", "1M"].includes(range)) { return Promise.resolve(null); }
  return cached(`cmc-history:v1:${id}:${range}`, HISTORY_TTL_SECONDS, async () => {
    const body = await getJson(`${PUBLIC}/detail/chart?id=${id}&range=${range}`);
    const points = Object.entries(asRow(asRow(body.data).points)).flatMap(([time, value]) => {
      const v = asRow(value).v;
      const list = Array.isArray(v) ? v : [];
      const price = positive(list[0]);
      const t = num(time);
      return price === null || t === null ? [] : [{ t: t * 1000, price, volume24h: positive(list[1]) }];
    }).sort((a, b) => a.t - b.t);
    return { id, symbol: ref.symbol, range, points } satisfies CmcHistory;
  }).catch((error: unknown) => {
    console.warn(`[cmc] history ${id} ${range}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
}
