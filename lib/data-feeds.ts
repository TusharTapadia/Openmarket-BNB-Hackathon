import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createPublicClient, http, keccak256, parseAbi, toBytes, type Address } from "viem";
import { cached } from "@/lib/cache";
import { atlasHistory, ATLAS_SYMBOLS } from "@/lib/atlas";
import { derivedPrice, OFFCHAIN_SOURCE_NAME, FEED_ASSETS, type DerivedPrice, type DerivedSource } from "@/lib/derived-price";

/**
 * Data feeds: every asset's aggregated price (lib/derived-price.ts), the
 * history of that aggregate and of each source behind it, and what the
 * on-chain oracle (contracts/PreIpoPriceOracle.sol) currently holds.
 *
 * History. Nothing upstream stores the aggregate, so this file records it:
 * each read of a feed takes a sample (the aggregate and each source's
 * per-share price) at most every SAMPLE_MIN_MS, and only when the derived price
 * has actually been recomputed (its `computedAt` moved), so a flat line is
 * never padded with copies. Samples live in a ring buffer in process memory
 * and, when Redis is configured, a coarser copy (one per PERSIST_EVERY_MS) is
 * pushed to a capped Redis list so a restart does not lose the day. Where a
 * source publishes its own history (Hyperliquid candles), that is used for its
 * line instead of our samples.
 */

/* ------------------------------------------------------------------ */
/* Assets and oracle configuration                                     */
/* ------------------------------------------------------------------ */

export type FeedAsset = { slug: string; name: string; symbol: string };

/**
 * The oracle's per-asset guards, as contracts/scripts/assets.js configures
 * them. Kept here because the app cannot load that CommonJS file; keep the two
 * in step.
 */
const ORACLE_DEFAULTS = { heartbeat: 25 * 60 * 60, maxDeviationBps: 1500, minSources: 1 };

export { UPDATE_POLICY } from "@/lib/update-policy";
const ORACLE_ASSETS: Record<string, { symbol: string; minSources?: number }> = {
  anthropic: { symbol: "ANTHROPIC", minSources: 3 },
  openai: { symbol: "OPENAI", minSources: 3 },
  anduril: { symbol: "ANDURIL" },
  neuralink: { symbol: "NEURALINK" },
  databricks: { symbol: "DATABRICKS" },
  "figure-ai": { symbol: "FIGUREAI" },
  kalshi: { symbol: "KALSHI" },
  polymarket: { symbol: "POLYMARKET" },
  oura: { symbol: "OURA" },
  spacex: { symbol: "SPACEX", minSources: 3 },
};

export type OracleAssetConfig = { symbol: string; key: `0x${string}`; heartbeat: number; maxDeviationBps: number; minSources: number; description: string };

export function oracleConfig(slug: string): OracleAssetConfig | null {
  const entry = ORACLE_ASSETS[slug];
  if (!entry) { return null; }
  return {
    ...ORACLE_DEFAULTS,
    minSources: entry.minSources ?? ORACLE_DEFAULTS.minSources,
    symbol: entry.symbol,
    key: keccak256(toBytes(entry.symbol)),
    description: `${entry.symbol} / USD`,
  };
}

/** The assets with a feed, as lib/derived-price.ts lists them. */
export function feedAssets(): FeedAsset[] {
  return FEED_ASSETS;
}

export function feedAsset(slug: string): FeedAsset | null {
  return feedAssets().find((asset) => asset.slug === slug) ?? null;
}

/* ------------------------------------------------------------------ */
/* Sources, normalised for display                                     */
/* ------------------------------------------------------------------ */

/** Fields the extended derived price may add to a source; all optional. */
type LooseSource = DerivedSource;

export interface FeedSource {
  id: string;
  label: string;
  kind: string;
  status: DerivedSource["status"];
  /** Where the price is made: the exchange, issuer or reference. */
  venue: string;
  /** Who runs the market when that is not the venue (a HIP-3 builder, a chain). */
  operator: string | null;
  market: string;
  price: number | null;
  rawPrice: number;
  rawUnit: string;
  note: string;
  volume24h: number | null;
  liquidityUsd: number | null;
  updatedAt: string;
  weight: number;
  weightShare: number;
  deviation: number | null;
  trust: number;
  popularity: number;
  /** How the weight is formed, in a few words. */
  weightMethod: string;
  /** For an aggregate source (Atlas), the exchange markets it is built from; they carry no weight here themselves. */
  components: FeedComponent[];
}

export type FeedComponent = { exchange: string; market: string; price: number | null; volume24h: number | null; updatedAt: string | null; status: string; weighting: number | null };

const WEIGHT_METHOD: Record<string, string> = {
  listing: "Reference, fixed depth",
  offchain: "Reference, fixed depth",
  perp: "Trust × volume and OI",
  spot: "Trust × volume",
  xstocks: "Trust × volume and cap",
  prestocks: "Trust × volume and cap",
  openstocks: "Trust × volume and cap",
  atlas: "Trust × volume, volume-weighted inside",
};

function iso(value: string | number | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === "") { return fallback; }
  const ms = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

export function normaliseSource(source: DerivedSource, computedAt: string): FeedSource {
  const loose = source as LooseSource;
  let venue = loose.exchange ?? source.provider;
  let operator: string | null = null;
  let market = loose.market ?? source.label;
  const on = /^(.*) on (.*)$/.exec(source.provider);
  const dot = source.provider.split(" · ");
  if (!loose.exchange && on) { operator = on[1]; venue = on[2]; }
  else if (!loose.exchange && dot.length === 2) { venue = dot[0]; operator = dot[1]; }
  if (source.kind === "atlas") { venue = "Atlas Oracle"; operator = null; }
  if (source.kind === "cmc") { operator = "CoinMarketCap"; }
  if (source.kind === "listing") {
    const [exchange, ticker] = source.label.split(": ");
    venue = loose.exchange ?? exchange;
    market = loose.market ?? (ticker ? `${ticker} / USD` : source.label);
    operator = null;
  }
  if (source.kind === "offchain") { venue = OFFCHAIN_SOURCE_NAME; market = loose.market ?? "Private transactions"; operator = null; }
  if (operator && operator.toLowerCase() === venue.toLowerCase()) { operator = null; }
  return {
    id: source.id,
    label: source.label,
    kind: source.kind,
    status: source.status,
    venue,
    operator,
    market,
    price: source.price,
    rawPrice: source.rawPrice,
    rawUnit: source.rawUnit,
    note: source.note,
    volume24h: typeof loose.volume24h === "number" && Number.isFinite(loose.volume24h) ? loose.volume24h : null,
    liquidityUsd: source.liquidityUsd,
    updatedAt: iso(loose.updatedAt, computedAt),
    weight: source.weight,
    weightShare: source.weightShare,
    deviation: source.deviation,
    trust: source.trust,
    popularity: source.popularity,
    // CoinMarketCap sources carry kind "spot"; their id says where they come from.
    weightMethod: source.id.startsWith("cmc:") ? "Trust × volume, via CoinMarketCap" : WEIGHT_METHOD[source.kind] ?? "Trust × liquidity",
    components: (source.components ?? []).map((component) => ({
      exchange: component.exchange, market: component.market, price: component.price, volume24h: component.volume24h,
      updatedAt: component.updatedAt, status: component.status, weighting: component.weighting,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Sampler                                                             */
/* ------------------------------------------------------------------ */

/** One reading of a feed: when it was computed, the aggregate, and each priced source. */
export type Sample = { t: number; a: number | null; s: Record<string, number> };

/** Never take two samples of one asset closer than this. */
const SAMPLE_MIN_MS = 5_000;
/** Samples kept per asset in memory: a week at one a minute. */
const MEMORY_CAP = 10_080;
/** One sample in this many milliseconds is also written to Redis. */
const PERSIST_EVERY_MS = 5 * 60_000;
/** Redis keeps a day of the coarse copy per asset (288 entries). */
const PERSIST_CAP = 288;
const PERSIST_TTL_SECONDS = 2 * 24 * 60 * 60;

type Buffer = { samples: Sample[]; lastTakenAt: number; lastPersistedAt: number; hydrated: boolean };
type SamplerHolder = { buffers: Map<string, Buffer> };

// Survives hot reloads in dev and warm instances in production, like lib/cache.ts.
const sampler: SamplerHolder = ((globalThis as Record<string, unknown>).__dataFeedSamples as SamplerHolder) ?? { buffers: new Map() };
(globalThis as Record<string, unknown>).__dataFeedSamples = sampler;

function buffer(slug: string): Buffer {
  let entry = sampler.buffers.get(slug);
  if (!entry) {
    entry = { samples: [], lastTakenAt: 0, lastPersistedAt: 0, hydrated: false };
    sampler.buffers.set(slug, entry);
  }
  return entry;
}

/**
 * The Redis client lib/cache.ts already holds, if it has one up. Reusing it
 * keeps this site to one connection on the shared instance; with no client
 * (no REDIS_URL, or not connected yet) history is memory-only.
 */
type MiniRedis = {
  status: string;
  rpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  expire(key: string, seconds: number): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
};
function redis(): MiniRedis | null {
  const holder = (globalThis as Record<string, unknown>).__marketsCache as { client?: MiniRedis | null } | undefined;
  const client = holder?.client ?? null;
  return client && client.status === "ready" ? client : null;
}
const redisKey = (slug: string) => `${process.env.REDIS_KEY_PREFIX?.trim() || "osmarkets"}:feeds:v1:${slug}`;

async function hydrate(slug: string, entry: Buffer): Promise<void> {
  if (entry.hydrated) { return; }
  const client = redis();
  if (!client) { return; }
  entry.hydrated = true;
  try {
    const raw = await client.lrange(redisKey(slug), 0, -1);
    const stored = raw.map((line) => { try { return JSON.parse(line) as Sample; } catch { return null; } })
      .filter((sample): sample is Sample => !!sample && typeof sample.t === "number");
    const known = new Set(entry.samples.map((sample) => sample.t));
    entry.samples = [...stored.filter((sample) => !known.has(sample.t)), ...entry.samples].sort((a, b) => a.t - b.t).slice(-MEMORY_CAP);
  } catch { /* history stays memory-only */ }
}

const roundPrice = (value: number) => Math.round(value * 1e6) / 1e6;

/** Records the feed if it is new enough; returns the asset's samples. */
export async function recordSample(feed: DerivedPrice): Promise<Sample[]> {
  const entry = buffer(feed.slug);
  await hydrate(feed.slug, entry);
  const t = Date.parse(feed.computedAt);
  const last = entry.samples[entry.samples.length - 1];
  const now = Date.now();
  if (Number.isFinite(t) && (!last || t > last.t) && now - entry.lastTakenAt >= SAMPLE_MIN_MS) {
    const s: Record<string, number> = {};
    for (const source of feed.sources) {
      if (source.status !== "excluded" && source.price !== null && source.price > 0) { s[source.id] = roundPrice(source.price); }
    }
    const sample: Sample = { t, a: feed.price === null ? null : roundPrice(feed.price), s };
    entry.samples.push(sample);
    if (entry.samples.length > MEMORY_CAP) { entry.samples.splice(0, entry.samples.length - MEMORY_CAP); }
    entry.lastTakenAt = now;
    const client = redis();
    if (client && t - entry.lastPersistedAt >= PERSIST_EVERY_MS) {
      entry.lastPersistedAt = t;
      const key = redisKey(feed.slug);
      // Every key carries a TTL (see lib/cache.ts: the instance is volatile-lru).
      void client.rpush(key, JSON.stringify(sample))
        .then(() => client.ltrim(key, -PERSIST_CAP, -1))
        .then(() => client.expire(key, PERSIST_TTL_SECONDS))
        .catch(() => { /* memory still holds it */ });
    }
  }
  return entry.samples;
}

export function samplesFor(slug: string): Sample[] {
  return sampler.buffers.get(slug)?.samples ?? [];
}

/** The aggregate's change over 24 hours, once samples reach back that far. */
export function change24h(samples: readonly Sample[]): number | null {
  const latest = samples[samples.length - 1];
  if (!latest || latest.a === null) { return null; }
  const target = latest.t - 24 * 3_600_000;
  if (samples[0].t > target + 3_600_000) { return null; }
  let base: Sample | null = null;
  for (const sample of samples) {
    if (sample.t <= target + 3_600_000 && sample.a !== null) { base = sample; }
    if (sample.t > target) { break; }
  }
  return base && base.a ? latest.a / base.a - 1 : null;
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export const INTERVALS = {
  "1s": { bucketMs: 1_000, windowMs: 15 * 60_000, candle: "1m" },
  "1m": { bucketMs: 60_000, windowMs: 6 * 3_600_000, candle: "1m" },
  "5m": { bucketMs: 5 * 60_000, windowMs: 24 * 3_600_000, candle: "5m" },
  "1h": { bucketMs: 3_600_000, windowMs: 7 * 86_400_000, candle: "1h" },
  "24h": { bucketMs: 86_400_000, windowMs: 180 * 86_400_000, candle: "1d" },
} as const;
export type Interval = keyof typeof INTERVALS;
export const isInterval = (value: string | null): value is Interval => !!value && value in INTERVALS;

export type HistoryLine = {
  key: string;
  /** The source id, or "aggregate". */
  id: string;
  label: string;
  /** "samples": our own readings; "venue": the venue's published candles. */
  origin: "samples" | "venue";
  points: number;
  /** The source's current distance from the aggregate, as a fraction; null for the aggregate. */
  deviation: number | null;
};
export type HistoryRow = { t: number } & Record<string, number | null>;
export interface FeedHistory {
  interval: Interval;
  bucketMs: number;
  from: number;
  to: number;
  /** Samples this process holds for the asset, over all time. */
  sampleCount: number;
  firstSampleAt: string | null;
  lines: HistoryLine[];
  rows: HistoryRow[];
}

const HL_INFO = "https://api.hyperliquid.xyz/info";

/** Close prices from Hyperliquid's candles for one market, by candle open time. */
async function hyperliquidCloses(coin: string, interval: string, start: number, end: number): Promise<Map<number, number>> {
  const once = async (): Promise<[number, number][]> => {
    const response = await fetch(HL_INFO, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime: start, endTime: end } }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) { throw new Error(`Hyperliquid ${response.status}`); }
    const body = await response.json() as { t: number; c: string }[] | null;
    // An unknown coin answers null; a throttled one, an error. Neither is cached.
    if (!Array.isArray(body)) { throw new Error("Hyperliquid returned no candles"); }
    return body.map((candle) => [candle.t, Number(candle.c)] as [number, number]).filter(([, close]) => Number.isFinite(close) && close > 0);
  };
  // The info endpoint answers a HIP-3 coin intermittently; one retry settles most.
  return cached(`data-feeds:hl:v1:${coin}:${interval}:${Math.floor(end / 60_000)}`, 60, () => once().catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return once();
  })).then((pairs) => new Map(pairs)).catch(() => new Map());
}

/** The Hyperliquid coin for a source id like "hyperliquid:perp:xyz:ANT", or null. */
function hyperliquidCoin(id: string): string | null {
  const match = /^hyperliquid:(?:perp|spot):(.+)$/.exec(id);
  return match ? match[1] : null;
}

export async function feedHistory(feed: DerivedPrice, samples: readonly Sample[], interval: Interval): Promise<FeedHistory> {
  const { bucketMs, windowMs, candle } = INTERVALS[interval];
  const to = Date.now();
  const from = to - windowMs;
  const bucket = (t: number) => Math.floor(t / bucketMs) * bucketMs;
  const rows = new Map<number, HistoryRow>();
  const row = (t: number) => {
    const at = bucket(t);
    let entry = rows.get(at);
    if (!entry) { entry = { t: at } as HistoryRow; rows.set(at, entry); }
    return entry;
  };

  // Heaviest first, so the chart's default lines are the ones that move the aggregate most.
  const priced = feed.sources.filter((source) => source.status !== "excluded" && source.price !== null)
    .sort((a, b) => b.weight - a.weight);
  const keys = new Map(priced.map((source, index) => [source.id, `s${index}`]));
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

  // Our samples, the last in each bucket winning.
  for (const sample of samples) {
    if (sample.t < from) { continue; }
    const entry = row(sample.t);
    if (sample.a !== null) { entry.agg = sample.a; }
    for (const [id, price] of Object.entries(sample.s)) {
      const key = keys.get(id);
      if (key) { entry[key] = price; }
    }
  }

  // Venue history where the venue publishes it, on the same per-share basis as the source.
  const venue = new Set<string>();
  // One at a time: Hyperliquid weighs candle requests heavily and throttles bursts.
  for (const source of priced) {
    const coin = hyperliquidCoin(source.id);
    if (!coin || !source.price || !source.rawPrice) { continue; }
    const scale = source.price / source.rawPrice;
    const closes = await hyperliquidCloses(coin, candle, from, to);
    if (!closes.size) { continue; }
    venue.add(source.id);
    const key = keys.get(source.id)!;
    for (const [t, close] of closes) {
      if (t >= from) { row(t)[key] = roundPrice(close * scale); }
    }
  }

  // Atlas publishes its aggregate's own history.
  const atlasSymbol = ATLAS_SYMBOLS[feed.slug];
  for (const source of priced) {
    if (!atlasSymbol || !source.id.startsWith("atlas:") || !source.price || !source.rawPrice) { continue; }
    const published = await atlasHistory(atlasSymbol, interval);
    if (!published?.points.length) { continue; }
    const scale = source.price / source.rawPrice;
    const key = keys.get(source.id)!;
    venue.add(source.id);
    for (const point of published.points) {
      if (point.t >= from) { row(point.t)[key] = roundPrice(point.price * scale); }
    }
  }

  const sorted = [...rows.values()].sort((a, b) => a.t - b.t);
  for (const entry of sorted) {
    for (const key of Object.keys(entry)) { if (key !== "t" && entry[key] !== null) { bump(key); } }
  }
  const lines: HistoryLine[] = [
    { key: "agg", id: "aggregate", label: "Aggregate", origin: "samples", points: counts.get("agg") ?? 0, deviation: null },
    ...priced.map((source) => {
      const key = keys.get(source.id)!;
      const display = normaliseSource(source, feed.computedAt);
      return { key, id: source.id, label: `${display.venue}: ${display.market}`, origin: venue.has(source.id) ? "venue" as const : "samples" as const, points: counts.get(key) ?? 0, deviation: source.deviation };
    }),
  ];
  return {
    interval, bucketMs, from, to,
    sampleCount: samples.length,
    firstSampleAt: samples.length ? new Date(samples[0].t).toISOString() : null,
    lines,
    rows: sorted,
  };
}

/* ------------------------------------------------------------------ */
/* On-chain                                                            */
/* ------------------------------------------------------------------ */

const ORACLE_ABI = parseAbi([
  "function latestRound(bytes32 key) view returns (uint80 roundId, (uint128 price, uint64 updatedAt, uint16 sourceCount, uint16 dispersionBps) round)",
  "function assetConfig(bytes32 key) view returns ((bool enabled, uint32 heartbeat, uint16 maxDeviationBps, uint16 minSources, string description))",
  "function isStale(bytes32 key) view returns (bool)",
  "function paused() view returns (bool)",
]);

const EXPLORERS: Record<number, { name: string; url: string }> = {
  56: { name: "BscScan", url: "https://bscscan.com" },
  97: { name: "BscScan testnet", url: "https://testnet.bscscan.com" },
};
const CHAIN_NAMES: Record<number, string> = { 56: "BNB Chain", 97: "BNB Chain testnet", 31337: "Hardhat local" };

export const KEEPER_COMMAND = "cd contracts && npm run keeper";
export const DEPLOY_COMMAND = "cd contracts && npm run deploy:bsc-testnet";

export type OnchainRound = { roundId: string; price: number; updatedAt: string; sourceCount: number; dispersionBps: number };
export type OnchainAsset = {
  slug: string;
  symbol: string;
  key: `0x${string}`;
  /** The asset's AggregatorV3 adapter, when the deployment file names one. */
  feed: string | null;
  config: { enabled: boolean; heartbeat: number; maxDeviationBps: number; minSources: number; description: string } | null;
  round: OnchainRound | null;
  stale: boolean | null;
  error: string | null;
};
export type Onchain =
  | { deployed: false; reason: string; deployCommand: string; keeperCommand: string; envVars: string[] }
  | { deployed: true; chainId: number; chainName: string; oracle: string; explorer: { name: string; url: string } | null; paused: boolean | null; readAt: string; assets: OnchainAsset[]; error: string | null; keeperCommand: string };

type Deployment = { chainId?: number; oracle?: string; assets?: Record<string, { feed?: string }> };

/**
 * contracts/deployments/*.json (the deploy script writes one per network),
 * for one chain or all of them: mainnet first, then newest first.
 */
async function deployments(chainId?: number): Promise<Deployment[]> {
  try {
    const dir = path.join(process.cwd(), "contracts", "deployments");
    const found: (Deployment & { deployedAt?: string })[] = [];
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".json")) { continue; }
      try {
        const body = JSON.parse(await readFile(path.join(dir, file), "utf8")) as Deployment & { deployedAt?: string };
        if ((chainId === undefined || body.chainId === chainId) && typeof body.oracle === "string") { found.push(body); }
      } catch { /* a malformed file is skipped */ }
    }
    return found.sort((a, b) => Number(b.chainId === 56) - Number(a.chainId === 56) || (b.deployedAt ?? "").localeCompare(a.deployedAt ?? ""));
  } catch {
    return []; // no deployments folder (nothing deployed, or a host without the contracts folder)
  }
}

/** Feed adapter addresses by symbol, from the deployment file for this chain and oracle. */
async function feedAddresses(chainId: number, oracle: string): Promise<Record<string, string>> {
  const match = (await deployments(chainId)).find((body) => body.oracle?.toLowerCase() === oracle.toLowerCase());
  return match?.assets ? Object.fromEntries(Object.entries(match.assets).flatMap(([symbol, entry]) => entry.feed ? [[symbol, entry.feed]] : [])) : {};
}

/** Public RPCs for the chains the deploy script targets, used when ORACLE_RPC_URL is unset. */
const DEFAULT_RPC: Record<number, string> = {
  56: "https://bsc-dataseed.bnbchain.org",
  97: "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
};

const ONCHAIN_TTL_SECONDS = 15;

/**
 * The oracle's state. The chain is ORACLE_CHAIN_ID, or else the one a
 * deployment file names (BNB Chain mainnet, 56, before any other), or else 97.
 * The address is ORACLE_ADDRESS, or else that chain's deployment file. The RPC
 * is ORACLE_RPC_URL or the chain's public endpoint. With no address at all,
 * the oracle counts as not deployed.
 */
export async function onchainState(): Promise<Onchain> {
  const envChain = process.env.ORACLE_CHAIN_ID?.trim();
  const files = await deployments(envChain ? Number(envChain) : undefined);
  const chainId = envChain ? Number(envChain) : files[0]?.chainId ?? 97;
  const fromEnv = process.env.ORACLE_ADDRESS?.trim();
  const address = fromEnv || files[0]?.oracle;
  const rpc = process.env.ORACLE_RPC_URL?.trim() || DEFAULT_RPC[chainId];
  if (!rpc || !address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return {
      deployed: false,
      reason: !address ? `No oracle address: ORACLE_ADDRESS is not set and contracts/deployments has no deployment for chain ${chainId}.`
        : !rpc ? `ORACLE_RPC_URL is not set and there is no default endpoint for chain ${chainId}.` : "ORACLE_ADDRESS is not a valid address.",
      deployCommand: DEPLOY_COMMAND,
      keeperCommand: KEEPER_COMMAND,
      envVars: ["ORACLE_RPC_URL", "ORACLE_ADDRESS", "ORACLE_CHAIN_ID"],
    };
  }
  return cached(`data-feeds:onchain:v1:${chainId}:${address.toLowerCase()}`, ONCHAIN_TTL_SECONDS, () => readOracle(rpc, address as Address, chainId));
}

async function readOracle(rpc: string, oracle: Address, chainId: number): Promise<Onchain> {
  const client = createPublicClient({ transport: http(rpc, { timeout: 8_000 }) });
  const feeds = await feedAddresses(chainId, oracle);
  const symbols = new Map(Object.entries(ORACLE_ASSETS).map(([slug, entry]) => [slug, entry.symbol]));
  for (const asset of feedAssets()) { if (!symbols.has(asset.slug)) { symbols.set(asset.slug, asset.symbol); } }

  let paused: boolean | null = null;
  let error: string | null = null;
  try {
    paused = await client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "paused" });
  } catch (reason) {
    error = `Could not reach the oracle: ${(reason as Error).message.split("\n")[0]}`;
  }

  const assets = error ? [] : await Promise.all([...symbols].map(async ([slug, symbol]): Promise<OnchainAsset> => {
    const key = keccak256(toBytes(symbol));
    const base = { slug, symbol, key, feed: feeds[symbol] ?? null };
    try {
      const [config, latest, stale] = await Promise.all([
        client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "assetConfig", args: [key] }),
        client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "latestRound", args: [key] }),
        client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "isStale", args: [key] }),
      ]);
      const [roundId, round] = latest;
      const configured = config.heartbeat > 0;
      return {
        ...base,
        config: configured ? { enabled: config.enabled, heartbeat: config.heartbeat, maxDeviationBps: config.maxDeviationBps, minSources: config.minSources, description: config.description } : null,
        round: round.updatedAt > BigInt(0) ? {
          roundId: roundId.toString(),
          price: Number(round.price) / 1e8,
          updatedAt: new Date(Number(round.updatedAt) * 1000).toISOString(),
          sourceCount: round.sourceCount,
          dispersionBps: round.dispersionBps,
        } : null,
        stale: configured ? stale : null,
        error: null,
      };
    } catch (reason) {
      return { ...base, config: null, round: null, stale: null, error: (reason as Error).message.split("\n")[0] };
    }
  }));

  return {
    deployed: true,
    chainId,
    chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
    oracle,
    explorer: process.env.ORACLE_EXPLORER_URL?.trim() ? { name: "Explorer", url: process.env.ORACLE_EXPLORER_URL.trim().replace(/\/$/, "") } : EXPLORERS[chainId] ?? null,
    paused,
    readAt: new Date().toISOString(),
    assets,
    error,
    keeperCommand: KEEPER_COMMAND,
  };
}

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export interface FeedSummary {
  slug: string;
  name: string;
  symbol: string;
  price: number | null;
  change24h: number | null;
  sourcesUsed: number;
  sourcesTotal: number;
  dispersionBps: number | null;
  computedAt: string | null;
  /** Recent aggregates, oldest first, for a sparkline. */
  spark: number[];
  sampleCount: number;
  oracle: OracleAssetConfig | null;
  error: string | null;
}

export interface FeedDetail {
  asset: FeedAsset;
  price: number | null;
  centre: number | null;
  dispersionBps: number | null;
  sourcesUsed: number;
  listed: boolean;
  computedAt: string;
  change24h: number | null;
  method: DerivedPrice["method"];
  sources: FeedSource[];
  history: FeedHistory;
  oracle: OracleAssetConfig | null;
}

export async function feedSummary(asset: FeedAsset): Promise<FeedSummary> {
  const base = { slug: asset.slug, name: asset.name, symbol: asset.symbol, oracle: oracleConfig(asset.slug) };
  try {
    const feed = await derivedPrice(asset.slug);
    if (!feed) { throw new Error("No derived price for this asset yet."); }
    const samples = await recordSample(feed);
    return {
      ...base,
      price: feed.price,
      change24h: change24h(samples),
      sourcesUsed: feed.sourcesUsed,
      sourcesTotal: feed.sources.length,
      dispersionBps: feed.dispersionBps,
      computedAt: feed.computedAt,
      spark: samples.slice(-60).flatMap((sample) => sample.a === null ? [] : [sample.a]),
      sampleCount: samples.length,
      error: null,
    };
  } catch (reason) {
    const samples = samplesFor(asset.slug);
    return { ...base, price: null, change24h: null, sourcesUsed: 0, sourcesTotal: 0, dispersionBps: null, computedAt: null, spark: [], sampleCount: samples.length, error: (reason as Error).message };
  }
}

export async function feedDetail(slug: string, interval: Interval): Promise<FeedDetail | null> {
  const asset = feedAsset(slug);
  if (!asset) { return null; }
  const feed = await derivedPrice(slug);
  if (!feed) { return null; }
  const samples = await recordSample(feed);
  return {
    asset,
    price: feed.price,
    centre: feed.centre,
    dispersionBps: feed.dispersionBps,
    sourcesUsed: feed.sourcesUsed,
    listed: feed.listed,
    computedAt: feed.computedAt,
    change24h: change24h(samples),
    method: feed.method,
    sources: feed.sources.map((source) => normaliseSource(source, feed.computedAt)),
    history: await feedHistory(feed, samples, interval),
    oracle: oracleConfig(slug),
  };
}
