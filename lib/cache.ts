import Redis from "ioredis";

/**
 * Shared response cache, backed by the same Redis the API uses.
 *
 * The instance is a 30MB free tier with `maxclients` 30 and a
 * `volatile-lru` eviction policy, and the API is already on it under the key
 * prefix `osapi`. This connects to that same instance under `osmarkets`, which
 * is what the prefix was put there for -- two services, one instance, neither
 * reading the other's entries.
 *
 * Sharing it imposes three rules, all of which this file enforces rather than
 * documents:
 *
 *  - One connection per process, reused. `maxclients` is 30 across both
 *    services, so a connection per request would starve the API, not just this
 *    site. The client is cached on `globalThis` so a warm serverless instance
 *    and a hot-reloading dev server both reuse one socket.
 *  - Every key carries a TTL. Under `volatile-lru` a key written without one
 *    cannot be evicted and will eventually wedge the instance for both
 *    services, so there is no way to call `set` without one.
 *  - Oversized payloads are dropped rather than stored, so one large response
 *    cannot evict the many small ones doing the real work.
 *
 * Cache trouble is never an error. Every path degrades to a miss and the caller
 * recomputes, so Redis going away makes this site slower, not broken.
 *
 * Reads go through two tiers. The instance is shared with the API rather than
 * co-located with this site, and a round trip to it measures ~235ms from here
 * -- against a page that makes eighteen of them, Redis alone would cost more
 * than the feed it is standing in front of. So each value is also held in
 * process memory for its TTL, which costs nothing and serves the repeat reads
 * within one warm instance. Redis remains the tier that survives a restart,
 * is shared between instances, and holds the stale copy.
 */

/** Redis Cloud free tier is 30MB and shared with the API; refuse to dominate it. */
const MAX_VALUE_BYTES = 128 * 1024;

/** Never let a caller pin a key indefinitely under volatile-lru. */
const MAX_TTL_SECONDS = 24 * 60 * 60;

/**
 * How much longer the stale copy outlives the fresh one.
 *
 * The point of this cache is not latency, it is that the upstream feed is a
 * free-tier service that goes away sometimes. Each value is written twice: a
 * fresh copy at its own TTL and a stale copy at this multiple of it. When the
 * feed fails, the stale copy is served and the page stays up with an older
 * reading, which is a far better answer than the 502 it returns today.
 */
const STALE_MULTIPLIER = 20;

const prefix = () => process.env.REDIS_KEY_PREFIX?.trim() || "osmarkets";
const freshKey = (key: string) => `${prefix()}:v1:${key}`;
const staleKey = (key: string) => `${prefix()}:stale:v1:${key}`;

type MemoryEntry = { value: unknown; expiresAt: number };
type Holder = {
  client: Redis | null;
  warned: boolean;
  memory: Map<string, MemoryEntry>;
  /** While set and in the future, readiness is not waited for again. */
  coldUntil: number;
};

/**
 * How long a command may wait for the connection to come up before giving up.
 *
 * `lazyConnect` plus `enableOfflineQueue: false` means a command issued before
 * the socket is ready fails instantly rather than queueing. That is the right
 * behaviour for a cache whose Redis has gone away, and the wrong behaviour on
 * the first request a fresh instance serves: the connection is still opening,
 * so the read misses, and -- with the feed down -- the stale read misses too
 * and the page 502s. That is the cold start, which on Vercel is every new
 * instance. So the first command waits for readiness, briefly.
 */
const READY_TIMEOUT_MS = 3_000;

/**
 * How long to stop waiting after a timeout.
 *
 * Without this, a genuinely unreachable Redis would make every request wait the
 * full timeout before falling through. After one failure the tier is treated as
 * absent for this long, which keeps an outage cheap.
 */
const COLD_COOLDOWN_MS = 30_000;

/**
 * Entries the in-process tier may hold before it starts dropping the oldest.
 *
 * This is a bound on a long-lived process, not a tuning knob: the site reads a
 * fixed set of routes, so the live set is tens of keys, and the cap exists so
 * an unforeseen key pattern cannot grow the map without limit.
 */
const MEMORY_MAX_ENTRIES = 256;
// Next recreates module scope on every hot reload in dev and may reuse a warm
// instance in production; `globalThis` is the only thing that survives both,
// and a client per reload would exhaust the shared connection budget.
const holder: Holder = ((globalThis as Record<string, unknown>).__marketsCache as Holder) ?? { client: null, warned: false, memory: new Map(), coldUntil: 0 };
(globalThis as Record<string, unknown>).__marketsCache = holder;

function client(): Redis | null {
  if (holder.client !== null) { return holder.client; }
  const url = process.env.REDIS_URL?.trim();
  // No URL is a supported configuration, not a misconfiguration: the site runs
  // uncached, which is exactly how it ran before this file existed.
  if (!url) { return null; }

  const redis = new Redis(url, {
    lazyConnect: true,
    // A cache must never queue work behind a dead dependency: fail the command,
    // let the caller recompute, and reconnect in the background.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
    reconnectOnError: () => true,
  });

  redis.on("error", (error: Error) => {
    // ioredis emits on every failed reconnect; one line per outage is enough.
    if (!holder.warned) {
      holder.warned = true;
      console.warn(`[cache] Redis unavailable, serving uncached: ${error.message}`);
    }
  });
  redis.on("ready", () => {
    holder.warned = false;
    holder.coldUntil = 0;
  });
  redis.connect().catch(() => { /* handled by the error listener */ });

  holder.client = redis;
  return redis;
}

export function cacheEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

/**
 * Resolves once the client can take a command, or false if it cannot soon.
 *
 * `status` is checked first so every call after the first returns immediately;
 * only a connecting or reconnecting client waits, and only up to the timeout.
 */
async function ready(redis: Redis): Promise<boolean> {
  if (redis.status === "ready") { return true; }
  if (Date.now() < holder.coldUntil) { return false; }
  if (redis.status === "end" || redis.status === "close") {
    redis.connect().catch(() => { /* reported by the error listener */ });
  }
  return new Promise<boolean>((resolve) => {
    const settle = (value: boolean) => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      if (!value) { holder.coldUntil = Date.now() + COLD_COOLDOWN_MS; }
      resolve(value);
    };
    const onReady = () => settle(true);
    const timer = setTimeout(() => settle(false), READY_TIMEOUT_MS);
    redis.once("ready", onReady);
  });
}

function memoryGet<T>(key: string): T | null {
  const entry = holder.memory.get(key);
  if (!entry) { return null; }
  if (entry.expiresAt <= Date.now()) {
    holder.memory.delete(key);
    return null;
  }
  return entry.value as T;
}

function memorySet(key: string, value: unknown, ttlSeconds: number): void {
  // Re-inserting moves the key to the end of the Map's insertion order, so the
  // key dropped below is genuinely the least recently written.
  holder.memory.delete(key);
  holder.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  while (holder.memory.size > MEMORY_MAX_ENTRIES) {
    const oldest = holder.memory.keys().next();
    if (oldest.done) { break; }
    holder.memory.delete(oldest.value);
  }
}

async function read<T>(key: string): Promise<T | null> {
  const redis = client();
  if (!redis || !(await ready(redis))) { return null; }
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = client();
  if (!redis || !(await ready(redis))) { return; }
  let payload: string;
  try {
    payload = JSON.stringify(value);
  } catch {
    return;
  }
  if (!payload || Buffer.byteLength(payload) > MAX_VALUE_BYTES) { return; }
  try {
    await redis.set(key, payload, "EX", Math.min(Math.ceil(ttlSeconds), MAX_TTL_SECONDS));
  } catch {
    // A value that failed to cache is recomputed next time, which is correct.
  }
}

/**
 * Returns the cached value for `key`, or computes, caches and returns it.
 *
 * On a miss the value is written twice, fresh and stale. If `compute` throws
 * and a stale copy is still held, that is returned instead of the error: an
 * hour-old price is worth more to a reader than a failed page, and the feed
 * only updates hourly anyway. With no stale copy the error propagates and the
 * route reports the outage as it did before.
 */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  // The memory tier runs even with no Redis configured: it is the cheaper half
  // of this and does not depend on the other.
  const local = memoryGet<T>(freshKey(key));
  if (local !== null) { return local; }

  // `null` and `undefined` are indistinguishable from a miss once stored, so a
  // call that legitimately resolves to nothing simply stays uncached.
  const hit = cacheEnabled() ? await read<T>(freshKey(key)) : null;
  if (hit !== null) {
    memorySet(freshKey(key), hit, ttlSeconds);
    return hit;
  }

  try {
    const value = await compute();
    if (value !== null && value !== undefined) {
      memorySet(freshKey(key), value, ttlSeconds);
      await Promise.all([
        write(freshKey(key), value, ttlSeconds),
        write(staleKey(key), value, ttlSeconds * STALE_MULTIPLIER),
      ]);
    }
    return value;
  } catch (error) {
    const stale = await read<T>(staleKey(key));
    if (stale !== null) {
      console.warn(`[cache] upstream failed for ${key}, served stale: ${(error as Error).message}`);
      return stale;
    }
    throw error;
  }
}
