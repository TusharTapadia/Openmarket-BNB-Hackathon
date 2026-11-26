import { cached } from "@/lib/cache";

/**
 * Atlas (atlasoracle.io), the CoinMarketCap-backed oracle that took over
 * Binance Oracle's feeds, publishes price feeds for tokenized stocks on BNB
 * Chain, among them ANTB (Anthropic) and SPCXB (SpaceX), Binance's "bStocks".
 *
 * Atlas has no documented public REST API. Its feed pages read two
 * unauthenticated JSON endpoints on api.atlasoracle.io, found in the site's
 * JavaScript bundle and used here as the site uses them:
 *
 *  POST /oracle/user/v1/oracle-feed/search
 *       {keyword, page, pageSize} → {data: {list, total}}
 *       Each feed: id, symbol, feedName, price (the aggregate), timestamp (ms),
 *       tags (e.g. VOLUME-WEIGHT), consensusScore/Status, supportPlatform
 *       (on-chain contracts) and sourceMarkets, the "Verified Data Sources":
 *       exchangeName, baseName/mainName, quote, volume24h, timestamp (s),
 *       status, exclude, shareMultiplier, marketId (CoinMarketCap's market id).
 *  POST /oracle/user/v1/oracle-feed/price-historical
 *       {feedId, modeType, interval: "1s" | "1min" | "5min" | "1h" | "24h"}
 *       → {data: {list: [{price, maxSourcePrice, minSourcePrice, timestamp (ms),
 *       markets: {marketId: price}, excludes}]}}, the "Price Dynamics" chart.
 *       modeType 2 is the pull (off-chain) series, which needs no platform id.
 *
 * The feed-detail endpoint the page also calls is behind a bot check and is
 * not used. Both endpoints above are undocumented and may change; every reader
 * here degrades to null rather than throwing into a page.
 */

const API = "https://api.atlasoracle.io/oracle/user/v1/oracle-feed";
const FEED_PAGE = "https://atlasoracle.io/feeds";
const TIMEOUT_MS = 12_000;
/** Atlas pushes on a 60s heartbeat or a 2% move; a 20s cache keeps reads close to live. */
const FEED_TTL_SECONDS = 20;
const HISTORY_TTL: Record<AtlasInterval, number> = { "1s": 15, "1m": 30, "5m": 60, "1h": 300, "24h": 900 };
const API_INTERVAL: Record<AtlasInterval, string> = { "1s": "1s", "1m": "1min", "5m": "5min", "1h": "1h", "24h": "24h" };
/** A source quote older than this is shown but marked stale. */
const STALE_SOURCE_MS = 30 * 60 * 1000;

/** The Atlas feed symbol for each company that has one: Binance's bStocks token for its listed shares. */
export const ATLAS_SYMBOLS: Record<string, string> = { anthropic: "ANTB", spacex: "SPCXB" };

export type AtlasInterval = "1s" | "1m" | "5m" | "1h" | "24h";
export const ATLAS_INTERVALS: readonly AtlasInterval[] = ["1s", "1m", "5m", "1h", "24h"];

export type AtlasSourceStatus = "active" | "stale" | "excluded" | "inactive";

export interface AtlasSource {
  /** CoinMarketCap's market id; the same id CMC's market-pairs endpoint uses. */
  marketId: string;
  exchange: string;
  exchangeLogo: string | null;
  /** "SPCXB/USDT". */
  market: string;
  /** Raw token price in USD, as the exchange quotes it. */
  price: number | null;
  volume24h: number | null;
  updatedAt: string | null;
  status: AtlasSourceStatus;
  /** Share of the aggregate, 0–1: this source's 24h volume over the volume of every active source (the feed is volume-weighted). Null when not weighted. */
  weighting: number | null;
  /** Shares one token stands for, as Atlas states it (1 for bStocks). */
  sharesPerToken: number;
}

export interface AtlasFeed {
  feedId: number;
  symbol: string;
  feedName: string;
  /** Aggregate price in USD for one token. */
  price: number;
  updatedAt: string;
  /** "VOLUME-WEIGHT" and the like, as Atlas tags the feed. */
  method: string[];
  consensusScore: number | null;
  consensusStatus: string | null;
  /** On-chain deployments (BNB Chain is platform 14). */
  contracts: { platformId: number; address: string; deviation: number | null; heartbeatSeconds: number | null }[];
  /** The feed's page on atlasoracle.io. */
  url: string;
  sources: AtlasSource[];
}

export interface AtlasPoint {
  /** Milliseconds since epoch. */
  t: number;
  price: number;
  min: number | null;
  max: number | null;
  /** Per-source price at this point, keyed by marketId. */
  markets: Record<string, number>;
}

export interface AtlasHistory {
  feedId: number;
  symbol: string;
  interval: AtlasInterval;
  points: AtlasPoint[];
}

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
/** Atlas mixes seconds and milliseconds; anything below 1e12 is seconds. */
const toIso = (value: unknown): string | null => {
  const parsed = num(value);
  if (parsed === null || parsed <= 0) { return null; }
  return new Date(parsed < 1e12 ? parsed * 1000 : parsed).toISOString();
};

async function post(path: string, body: unknown): Promise<Row> {
  const response = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "markets-feeds/1.0" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) { throw new Error(`api.atlasoracle.io returned ${response.status}`); }
  const json = asRow(await response.json());
  const error = asRow(json.status);
  if (!json.data && error.error_message) { throw new Error(`api.atlasoracle.io: ${String(error.error_message)}`); }
  return asRow(json.data);
}

function parseFeed(row: Row, now: number): AtlasFeed | null {
  const feedId = num(row.id);
  const symbol = str(row.symbol);
  const price = positive(row.price);
  const updatedAt = toIso(row.timestamp);
  // The feed's own multiplier scales the published price; only 1 is a plain token price.
  if (feedId === null || !symbol || price === null || !updatedAt || (num(row.multiplier) ?? 1) !== 1) { return null; }
  const markets = asList(row.sourceMarkets).filter((market) => num(market.status) !== 3);
  const parsed = markets.map((market): Omit<AtlasSource, "weighting"> => {
    const quote = positive(market.quote);
    const at = toIso(market.timestamp);
    const excluded = num(market.exclude) === 1;
    const stale = at !== null && now - Date.parse(at) > STALE_SOURCE_MS;
    return {
      marketId: String(market.marketId ?? ""),
      exchange: str(market.dataSourceName) ?? str(market.exchangeName) ?? "Unknown",
      exchangeLogo: str(market.dataSourceLogo) ?? str(market.exchangeLogo),
      market: `${str(market.baseName) ?? symbol}/${str(market.mainName) ?? "USD"}`,
      price: quote,
      volume24h: positive(market.volume24h) ?? positive(market.volumeUsd),
      updatedAt: at,
      status: excluded ? "excluded" : num(market.selected) === 0 ? "inactive" : stale ? "stale" : "active",
      sharesPerToken: positive(market.shareMultiplier) ?? 1,
    };
  });
  const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const volumeWeighted = tags.includes("VOLUME-WEIGHT");
  const activeVolume = parsed.filter((source) => source.status === "active").reduce((sum, source) => sum + (source.volume24h ?? 0), 0);
  const sources: AtlasSource[] = parsed
    .map((source) => ({
      ...source,
      weighting: volumeWeighted && source.status === "active" && activeVolume > 0 && source.volume24h ? source.volume24h / activeVolume : null,
    }))
    .sort((a, b) => (b.weighting ?? -1) - (a.weighting ?? -1) || (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return {
    feedId,
    symbol,
    feedName: str(row.feedName) ?? `${symbol}/USD`,
    price,
    updatedAt,
    method: tags,
    consensusScore: num(row.consensusScore),
    consensusStatus: str(row.consensusStatus),
    contracts: asList(row.supportPlatform).flatMap((platform) => {
      const address = str(platform.contractAddress);
      return address ? [{ platformId: num(platform.platformId) ?? 0, address, deviation: num(platform.deviation), heartbeatSeconds: num(platform.heartbeat) }] : [];
    }),
    url: `${FEED_PAGE}/${feedId}`,
    sources,
  };
}

/**
 * Every Atlas USD feed for a symbol. A symbol can have more than one (SPCXB
 * has two BNB Chain feeds); the first is the one with the most active sources.
 */
async function feedsFor(symbol: string): Promise<AtlasFeed[]> {
  const wanted = symbol.toUpperCase();
  const data = await post("search", { keyword: wanted, page: 1, pageSize: 20 });
  const now = Date.now();
  return asList(data.list)
    .filter((row) => str(row.symbol)?.toUpperCase() === wanted && (str(row.mainSymbol) ?? "USD") === "USD")
    .flatMap((row) => { const feed = parseFeed(row, now); return feed ? [feed] : []; })
    .sort((a, b) => b.sources.filter((s) => s.status === "active").length - a.sources.filter((s) => s.status === "active").length
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** The Atlas feed for a token symbol ("ANTB", "SPCXB"), or null when Atlas has none or does not answer. */
export function atlasFeed(symbol: string): Promise<AtlasFeed | null> {
  const key = symbol.toUpperCase();
  return cached(`atlas-feed:v1:${key}`, FEED_TTL_SECONDS, async () => (await feedsFor(key))[0] ?? null)
    .catch((error: unknown) => {
      console.warn(`[atlas] ${key}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
}

/**
 * The feed's "Price Dynamics" series at one interval, oldest first: 300 points
 * at 1s/1m/5m, about a week of hours at 1h, and one point a day at 24h. Null
 * when Atlas has no feed for the symbol or does not answer.
 */
export function atlasHistory(symbol: string, interval: AtlasInterval): Promise<AtlasHistory | null> {
  const key = symbol.toUpperCase();
  if (!ATLAS_INTERVALS.includes(interval)) { return Promise.resolve(null); }
  return cached(`atlas-history:v1:${key}:${interval}`, HISTORY_TTL[interval], async () => {
    const feed = await atlasFeed(key);
    if (!feed) { return null; }
    const data = await post("price-historical", { feedId: feed.feedId, modeType: 2, interval: API_INTERVAL[interval] });
    const points = asList(data.list).flatMap((row): AtlasPoint[] => {
      const price = positive(row.price);
      const t = num(row.timestamp);
      if (price === null || t === null) { return []; }
      const markets = Object.fromEntries(Object.entries(asRow(row.markets)).flatMap(([id, value]) => {
        const quote = positive(value);
        return quote === null ? [] : [[id, quote]];
      }));
      return [{ t: t < 1e12 ? t * 1000 : t, price, min: positive(row.minSourcePrice), max: positive(row.maxSourcePrice), markets }];
    }).sort((a, b) => a.t - b.t);
    return { feedId: feed.feedId, symbol: feed.symbol, interval, points } satisfies AtlasHistory;
  }).catch((error: unknown) => {
    console.warn(`[atlas] ${key} ${interval} history: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
}
