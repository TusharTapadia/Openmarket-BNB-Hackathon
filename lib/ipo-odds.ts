import { cached } from "@/lib/cache";

/**
 * When traders expect each covered company to go public, read from Kalshi's
 * "When will X IPO?" date ladders. Each rung asks whether the IPO is confirmed
 * before a deadline, and Kalshi confirms it when the SEC declares the Form S-1
 * effective, the IPO prices, or an exchange assigns a ticker.
 *
 * - expected: the date the odds cross 50%, interpolated between the two rungs
 *   either side, the market's median date for the S-1 going effective;
 * - latest: the furthest deadline the market prices, with the odds at it.
 *
 * Companies without a ladder are left out; nothing is estimated for them.
 */

export type IpoOdds = {
  /** ISO date the odds cross 50%, or null when no rung reaches 50%. */
  expected: string | null;
  /** The furthest deadline priced, ISO date. */
  latest: string;
  /** Odds the S-1 is effective by the latest deadline, 0 to 1. */
  latestOdds: number;
  url: string;
};

const SERIES: Record<string, string> = {
  openai: "KXIPOOPENAI",
  anduril: "KXIPOANDURIL",
  oura: "KXIPOOURA",
  databricks: "KXDATABRICKS",
};

const TTL_SECONDS = 15 * 60;
const DAY_MS = 86_400_000;

type Rung = { date: number; odds: number };

const num = (value: unknown) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; };

/** The rung's odds: the bid-ask midpoint when the book is tight, else the last trade. */
function oddsOf(market: Record<string, unknown>): number | null {
  const bid = num(market.yes_bid_dollars), ask = num(market.yes_ask_dollars), last = num(market.last_price_dollars);
  if (bid !== null && ask !== null && ask > 0 && ask - bid <= 0.15) { return (bid + ask) / 2; }
  return last;
}

/** "Before Oct 1, 2027" settles at the close: the deadline is that day. */
function deadlineOf(market: Record<string, unknown>): number | null {
  const close = typeof market.close_time === "string" ? Date.parse(market.close_time) : NaN;
  return Number.isFinite(close) ? Date.UTC(new Date(close).getUTCFullYear(), new Date(close).getUTCMonth(), new Date(close).getUTCDate()) : null;
}

async function ladder(series: string): Promise<IpoOdds | null> {
  const response = await fetch(`https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&status=open&limit=100`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) { throw new Error(`Kalshi returned ${response.status}`); }
  const body = await response.json() as { markets?: Record<string, unknown>[] };
  const now = Date.now();
  const rungs = (body.markets ?? []).flatMap((market): Rung[] => {
    const date = deadlineOf(market), odds = oddsOf(market);
    return date !== null && odds !== null && date > now ? [{ date, odds }] : [];
  }).sort((a, b) => a.date - b.date);
  if (!rungs.length) { return null; }
  // Odds of "by a later date" can never be lower; a thin rung that dips is lifted to the one before it.
  for (let index = 1; index < rungs.length; index += 1) { rungs[index].odds = Math.max(rungs[index].odds, rungs[index - 1].odds); }
  const crossing = rungs.findIndex((rung) => rung.odds >= 0.5);
  let expected: number | null = null;
  if (crossing >= 0) {
    const before = crossing > 0 ? rungs[crossing - 1] : { date: now, odds: 0 };
    const after = rungs[crossing];
    const span = after.odds - before.odds;
    expected = span > 0 ? before.date + (after.date - before.date) * (0.5 - before.odds) / span : after.date;
  }
  const last = rungs[rungs.length - 1];
  const iso = (time: number) => new Date(Math.round(time / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
  return { expected: expected === null ? null : iso(expected), latest: iso(last.date), latestOdds: last.odds, url: `https://kalshi.com/markets/${series.toLowerCase()}` };
}

/** Kalshi's IPO timing for every covered company that has a ladder, keyed by slug. */
export function ipoOdds(): Promise<Record<string, IpoOdds>> {
  return cached("kalshi-ipo-odds:v1", TTL_SECONDS, async () => {
    const entries = await Promise.all(Object.entries(SERIES).map(async ([slug, series]) => [slug, await ladder(series).catch(() => null)] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [string, IpoOdds] => entry[1] !== null));
  });
}
