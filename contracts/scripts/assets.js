/**
 * The assets the oracle carries: the site's company slug, the on-chain symbol
 * (key = keccak256(bytes(symbol))), and the guards each is configured with.
 *
 * heartbeat        seconds before a price counts as stale on the contract: the 24-hour
 *                  update schedule plus an hour of slack
 * maxDeviationBps  largest move one update may make; 1500 = 15%, the same band the
 *                  derived price uses for outliers
 * minSources       sources an update must be drawn from
 */
const DEFAULTS = { heartbeat: 25 * 60 * 60, maxDeviationBps: 1500, minSources: 1 };

/**
 * When the keeper pushes an asset: once its on-chain price is 24 hours old, or
 * sooner when the live price has moved 0.5% from it. It checks every 5 minutes.
 * lib/data-feeds.ts carries the same numbers for the site; keep them in step.
 */
const POLICY = { pushEverySeconds: 24 * 60 * 60, deviationBps: 50, checkEverySeconds: 5 * 60 };

const ASSETS = [
  { slug: "anthropic", symbol: "ANTHROPIC", minSources: 3 },
  { slug: "openai", symbol: "OPENAI", minSources: 3 },
  { slug: "anduril", symbol: "ANDURIL" },
  { slug: "neuralink", symbol: "NEURALINK" },
  { slug: "databricks", symbol: "DATABRICKS" },
  { slug: "figure-ai", symbol: "FIGUREAI" },
  { slug: "kalshi", symbol: "KALSHI" },
  { slug: "polymarket", symbol: "POLYMARKET" },
  { slug: "oura", symbol: "OURA" },
  // Listed on Nasdaq as SPCX; priced from the listing, Atlas SPCXB and CoinMarketCap's tokenized-share markets.
  { slug: "spacex", symbol: "SPACEX", minSources: 3 },
].map((asset) => ({ ...DEFAULTS, ...asset, description: `${asset.symbol} / USD` }));

module.exports = { ASSETS, DEFAULTS, POLICY };
