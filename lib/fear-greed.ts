import type { CompanyPoint, MarketPoint } from "@/lib/market-series";

/**
 * A fear and greed reading for this market, 0 to 100.
 *
 * The familiar version of this index is built for crypto and leans on things
 * that do not exist here -- social posts, search trends, the dominance of one
 * asset over the rest. What this market has is six companies, a recorded daily
 * price and volume for each, and the venues quoting them. So the reading is
 * built from those, and the parts are published rather than implied: a number
 * between 0 and 100 with nothing behind it is worth less than four numbers you
 * can argue with.
 *
 * Every component is computed from the *recorded* series, never from a live
 * reading. Funding and open interest would both belong here on the merits --
 * they are the clearest sentiment signals the venues publish -- but only their
 * current value is stored, not their history. Folding them into the score
 * would make today's gauge measure something the line behind it cannot, and
 * the two would disagree under one label. They are reported alongside instead.
 */

export type ComponentKey = "momentum" | "volatility" | "breadth" | "volume";

export type Component = {
  key: ComponentKey;
  label: string;
  /** 0 = maximum fear, 100 = maximum greed. */
  score: number;
  /** What the underlying measurement actually was, for the tooltip. */
  reading: string;
};

export type FearGreedPoint = { at: string; score: number };

export type Band = "Extreme fear" | "Fear" | "Neutral" | "Greed" | "Extreme greed";

export function band(score: number): Band {
  if (score < 20) { return "Extreme fear"; }
  if (score < 40) { return "Fear"; }
  if (score < 60) { return "Neutral"; }
  if (score < 80) { return "Greed"; }
  return "Extreme greed";
}

/**
 * Maps a ratio around 1 onto 0..100, where `span` is the deviation that reaches
 * the end of the scale.
 *
 * Linear and clamped rather than a percentile of its own history: this market
 * has about three months of recorded days, and a percentile over a window that short
 * would call the quietest week of a calm stretch "extreme fear" simply because
 * it was the calmest of the few weeks on file.
 */
function fromRatio(ratio: number, span: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) { return 50; }
  return Math.max(0, Math.min(100, 50 + ((ratio - 1) / span) * 50));
}

const mean = (values: readonly number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function stdev(values: readonly number[]): number {
  if (values.length < 2) { return 0; }
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/** Day-over-day returns of a series, oldest first. */
function returns(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] > 0) { out.push(values[i] / values[i - 1] - 1); }
  }
  return out;
}

const MOMENTUM_WINDOW = 30;
const VOL_FAST = 10;
/**
 * Thirty days, not the sixty a longer-running market would use.
 *
 * The market series can only start where every company it covers has a price,
 * and the most recent arrival joined in July -- so there are about ninety
 * recorded days to work with, whatever the feed holds for the older companies.
 * A sixty-day volatility baseline spent two thirds of that warming up and left
 * a month to plot. Ten days against thirty is still fast against slow, and it
 * leaves a chart worth reading.
 */
const VOL_SLOW = 30;
const VOLUME_WINDOW = 30;

/** The earliest day with enough history behind it to score. */
const WARMUP = Math.max(MOMENTUM_WINDOW, VOL_SLOW, VOLUME_WINDOW);

type Inputs = {
  /** The market series, oldest first. */
  market: readonly MarketPoint[];
  /** Each company's own daily series, oldest first, keyed by slug. */
  companies: ReadonlyMap<string, readonly CompanyPoint[]>;
};

/**
 * The four components as of day `index` in the market series.
 *
 * Returns null before the warm-up is satisfied, so an early day is left off
 * the chart rather than drawn from a window that is mostly missing.
 */
function componentsAt(inputs: Inputs, index: number): Component[] | null {
  const { market, companies } = inputs;
  if (index < WARMUP) { return null; }

  const levels = market.slice(0, index + 1).map((point) => point.index);
  const volumes = market.slice(0, index + 1).map((point) => point.volume);
  const today = market[index];

  // Momentum: where the market sits against its own recent average. Above it
  // is greed, below is fear, and 10% either way reaches the end of the scale.
  const momentumBase = mean(levels.slice(-MOMENTUM_WINDOW));
  const momentum = fromRatio(momentumBase > 0 ? today.index / momentumBase : 1, 0.1);

  // Volatility: recent movement against the longer norm, inverted. A market
  // moving unusually hard is a frightened one, whichever way it is moving.
  const series = returns(levels);
  const fast = stdev(series.slice(-VOL_FAST));
  const slow = stdev(series.slice(-VOL_SLOW));
  const volatility = slow > 0 ? 100 - fromRatio(fast / slow, 0.8) : 50;

  // Breadth: how many of the companies quoted that day rose. Measured per
  // company rather than off the index, because the index is valuation-weighted
  // and two large companies can carry it while the rest fall.
  let up = 0;
  let counted = 0;
  for (const points of companies.values()) {
    const at = points.findIndex((point) => point.at === today.at);
    if (at > 0) {
      counted += 1;
      if (points[at].price > points[at - 1].price) { up += 1; }
    }
  }
  const breadth = counted ? (up / counted) * 100 : 50;

  // Volume: the day's trading against its own recent average. Heavier than
  // usual is conviction; a market that has stopped trading is a fearful one.
  const volumeBase = mean(volumes.slice(-VOLUME_WINDOW));
  const volume = fromRatio(volumeBase > 0 ? today.volume / volumeBase : 1, 1);

  // Rounded before the sign is read off it: a shift of -0.04% rounds to
  // nothing, and printing it as "-0.0%" claims a direction the score does not.
  const shift = momentumBase > 0 ? Number(((today.index / momentumBase - 1) * 100).toFixed(1)) + 0 : 0;

  return [
    { key: "momentum", label: "Momentum", score: momentum, reading: momentumBase > 0 ? `${shift > 0 ? "+" : ""}${shift.toFixed(1)}% vs its ${MOMENTUM_WINDOW}-day average` : "not enough history" },
    { key: "volatility", label: "Volatility", score: volatility, reading: slow > 0 ? `${(fast / slow).toFixed(2)}x its ${VOL_SLOW}-day normal` : "not enough history" },
    { key: "breadth", label: "Breadth", score: breadth, reading: counted ? `${up} of ${counted} companies quoted rose` : "no company quoted twice running" },
    { key: "volume", label: "Volume", score: volume, reading: volumeBase > 0 ? `${(today.volume / volumeBase).toFixed(2)}x its ${VOLUME_WINDOW}-day average` : "not enough history" },
  ];
}

/** Equal weights: nothing here justifies claiming one signal leads the others. */
const score = (components: readonly Component[]) =>
  Math.round(mean(components.map((component) => component.score)));

/**
 * The recorded days split three ways.
 *
 * Three buckets rather than the five bands: across ninety days this market has
 * never once touched extreme fear, so a five-row card would have spent two of
 * its rows printing zero.
 */
export function spread(history: readonly FearGreedPoint[]): { greed: number; neutral: number; fear: number } {
  let greed = 0;
  let neutral = 0;
  let fear = 0;
  for (const point of history) {
    if (point.score >= 60) { greed += 1; }
    else if (point.score >= 40) { neutral += 1; }
    else { fear += 1; }
  }
  return { greed, neutral, fear };
}

export type Run = {
  band: Band;
  days: number;
  /** The first day of the current run. */
  since: string;
  longest: { band: Band; days: number };
};

/** The stretch of days ending on the last reading that stayed in one band. */
export function run(history: readonly FearGreedPoint[]): Run | null {
  if (!history.length) { return null; }
  const runs: { band: Band; days: number; from: string }[] = [];
  for (const point of history) {
    const current = band(point.score);
    const held = runs[runs.length - 1];
    if (held && held.band === current) { held.days += 1; }
    else { runs.push({ band: current, days: 1, from: point.at }); }
  }
  const current = runs[runs.length - 1];
  const longest = runs.reduce((held, candidate) => (candidate.days > held.days ? candidate : held));
  return { band: current.band, days: current.days, since: current.from, longest: { band: longest.band, days: longest.days } };
}

/**
 * The middle of the record, and where the latest reading stands in it.
 *
 * Median as well as average because the average of a scale that clamps at
 * either end is pulled by the days that hit the clamp, and this market has
 * them: a day trading at three times its usual volume scores the same 100 as
 * one trading at twice, so the mean carries a little of that flattening.
 */
export function typical(history: readonly FearGreedPoint[]): { average: number; median: number; percentile: number } | null {
  if (!history.length) { return null; }
  const scores = history.map((point) => point.score);
  const sorted = [...scores].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  const latest = scores[scores.length - 1];
  // Against the other recorded days, not including the one being placed.
  const below = sorted.filter((score) => score < latest).length;
  return {
    average: Math.round(mean(scores)),
    median,
    percentile: sorted.length > 1 ? Math.round((below / (sorted.length - 1)) * 100) : 0,
  };
}

export type FearGreed = {
  score: number;
  band: Band;
  components: Component[];
  history: FearGreedPoint[];
  /** Days of recorded history the reading could be drawn from. */
  recordedDays: number;
  /** Days discarded to warm the trailing windows. */
  warmupDays: number;
};

export function fearGreed(inputs: Inputs): FearGreed | null {
  const { market } = inputs;
  const latest = componentsAt(inputs, market.length - 1);
  if (!latest) { return null; }

  const history: FearGreedPoint[] = [];
  for (let index = WARMUP; index < market.length; index += 1) {
    const components = componentsAt(inputs, index);
    if (components) { history.push({ at: market[index].at, score: score(components) }); }
  }

  const now = score(latest);
  return {
    score: now,
    band: band(now),
    components: latest,
    history,
    recordedDays: market.length,
    warmupDays: WARMUP,
  };
}
