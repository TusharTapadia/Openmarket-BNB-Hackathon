import { atlasFeed, ATLAS_SYMBOLS, type AtlasFeed } from "@/lib/atlas";
import { cached } from "@/lib/cache";
import { cmcCompany, type CmcAsset } from "@/lib/cmc";
import { companyView, LISTED, VENUE_NAMES, type CoverageCompany, type MarketRow } from "@/lib/coverage-view";
import { issuerTokens, type IssuerToken } from "@/lib/issuers";
import { marketCoverage } from "@/lib/market-coverage";
import { COVERAGE_COMPANIES } from "@/lib/market-coverage/shared";
import { offchainData, type OffchainCompany } from "@/lib/offchain";
import { postIpo } from "@/lib/post-ipo";

/**
 * A derived price for one share of a company: every source we can read,
 * normalised to one share, weighted by how far we trust that kind of source
 * and how much is actually traded on it.
 *
 *   weight_i   = trust_i × popularity_i
 *   centre     = weighted median of the normalised prices
 *   included   = sources within OUTLIER_BAND of the centre
 *   price      = Σ weight_i × price_i / Σ weight_i     (over included sources)
 *
 * Units are never mixed silently. Each source carries a basis:
 *  - "share": it quotes one share directly (confirmed by the venue, or the
 *    issuer's stated one-token-one-share design);
 *  - "rescaled": it quotes something else on a known scale (a valuation in
 *    billions, a token worth ten shares) and is divided back to one share;
 *  - "inferred": the unit is not published, and the price is taken as one
 *    share only because it lands next to the share-basis sources.
 * A source whose unit cannot be placed is listed as excluded, never averaged.
 */

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

/**
 * How much each kind of source is believed, 0–1, before liquidity is
 * considered. This is a judgement table, meant to be tuned here.
 *
 * - listing: the public exchange price once a company has listed.
 * - offchain: AllocationsX's price from private-market transactions; the best
 *   read of a share before a listing.
 * - perp: a perpetual future's mark; deep and arbitraged, but it prices an
 *   expectation, carries funding and can drift from any real share.
 * - atlas: the Atlas oracle's aggregate for a tokenized share (ANTB, SPCXB):
 *   a volume-weighted price across the exchanges it verifies, scored by its
 *   own consensus check. One source, however many exchanges stand behind it.
 * - spot: an exchange spot pair for a wrapped or synthetic token.
 * - cmc: a tokenized share price from one exchange, reported by CoinMarketCap.
 * - xStocks / PreStocks / OpenStocks: issuer tokens; real claims on a share,
 *   but traded in thin pools and quoted at the issuer's discretion.
 *
 * `basis` scales trust by how sure we are of the unit, and `listedOffchain`
 * scales the off-chain price once the public market supersedes it.
 */
export const TRUST_TABLE = {
  classes: {
    listing: 0.95,
    offchain: 0.85,
    atlas: 0.75,
    perp: 0.7,
    xstocks: 0.55,
    prestocks: 0.5,
    spot: 0.45,
    cmc: 0.4,
    openstocks: 0.4,
    paimon: 0.4,
  },
  basis: { share: 1, rescaled: 0.8, inferred: 0.6 },
  listedOffchain: 0.6,
} as const;

export type SourceClass = keyof typeof TRUST_TABLE.classes;
export type Basis = keyof typeof TRUST_TABLE.basis;

/** A source further than this from the weighted median is an outlier and carries no weight. */
export const OUTLIER_BAND = 0.15;

/**
 * Popularity is a log-scaled score of daily dollar liquidity L:
 *
 *   popularity = clamp((log10(1 + L) − 3) / 6, POPULARITY_FLOOR, 1)
 *
 * so $1K a day scores 0, $1M scores 0.5 and $1B scores 1. L is
 *   perp:          daily volume + 0.25 × open interest
 *   exchange spot: daily volume
 *   issuer token:  daily volume + 0.1 × token market cap,
 *                  plus 0.05 × log10(1 + holders) on the score
 * where daily volume is 30d volume / 30 when known, else the 24h figure, and
 * for an issuer token with neither, all-time volume / 365.
 */
export const POPULARITY = {
  /** log10 of the liquidity that scores 0. */
  zeroAt: 3,
  /** Decades of liquidity from 0 to 1. */
  span: 6,
  openInterestShare: 0.25,
  tokenCapShare: 0.1,
  holdersBonus: 0.05,
  /** A quoted source with no liquidity figure still counts, barely. */
  floor: 0.05,
  /**
   * Reference prices are not order books and have no volume here, so their
   * popularity is fixed: a national exchange listing is the deepest market
   * there is; off-chain transactions are real but infrequent.
   */
  listing: 1,
  offchain: 0.6,
} as const;

/** A perp with no published unit counts as that unit only within this ratio of the share reference. */
const SAME_UNIT_RATIO = 1.25;
/** An issuer or spot token is one share by design; outside this ratio it is quoting something else. */
const TOKEN_UNIT_RATIO = 3;
/** The notional share count valuation-quoted perps use: price × 1e9 is the valuation. */
const VALUATION_NOTIONAL = 1e9;

/**
 * Shares one OpenStocks token stands for, where OpenStocks states it. Same
 * figures as `OPENSTOCKS_REFERENCE` in lib/post-ipo.ts (one oANTHROPIC = 10
 * ANT shares, one oANTHROPICx = one share); keep the two in step.
 */
const OPENSTOCKS_SHARES_PER_TOKEN: Record<string, number> = { oANTHROPIC: 10, oANTHROPICx: 1 };

const TTL_SECONDS = 60;

export const OFFCHAIN_SOURCE_NAME = "Offchain Private Markets";

/** An Atlas aggregate older than this is not a current price (its heartbeat is 60s). */
const ATLAS_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * CoinMarketCap markets taken per token: the largest exchanges by 24h volume,
 * each above a floor. Dozens of small pools quoting the same token would add
 * weight without adding information, so the tail is left out.
 */
export const CMC_LIMITS = { exchangesPerToken: 3, minVolumeUsd: 50_000 } as const;

/**
 * Every company with a derived price, and the symbol the on-chain oracle
 * carries it under (contracts/scripts/assets.js). SpaceX is not a covered
 * company (no market coverage), but has a listing, Atlas and CoinMarketCap
 * sources and issuer tokens, which is enough for a price.
 */
const ORACLE_SYMBOLS: Record<string, string> = {
  anthropic: "ANTHROPIC", openai: "OPENAI", anduril: "ANDURIL", neuralink: "NEURALINK", databricks: "DATABRICKS",
  "figure-ai": "FIGUREAI", kalshi: "KALSHI", polymarket: "POLYMARKET", oura: "OURA", spacex: "SPACEX",
};
export const FEED_ASSETS: { slug: string; name: string; symbol: string }[] = [
  ...COVERAGE_COMPANIES.map((company) => ({ slug: company.slug, name: company.name, symbol: ORACLE_SYMBOLS[company.slug] ?? company.names[0] })),
  { slug: "spacex", name: "SpaceX", symbol: "SPACEX" },
];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SourceStatus = "included" | "outlier" | "excluded";

export interface DerivedSource {
  id: string;
  label: string;
  /** Venue, issuer or feed. */
  provider: string;
  kind: SourceClass;
  /** The price as the source quotes it. */
  rawPrice: number;
  /** What `rawPrice` measures. */
  rawUnit: string;
  /** `rawPrice` for one share; null when the unit could not be placed. */
  price: number | null;
  basis: Basis | null;
  /** How the price was normalised, or why it was left out. */
  note: string;
  trust: number;
  popularity: number;
  /** Daily dollar liquidity behind the popularity score; null for reference prices. */
  liquidityUsd: number | null;
  /** The figures liquidity was worked out from, in words. */
  liquidityNote: string;
  /** trust × popularity; zero for anything not included. */
  weight: number;
  /** Share of the total weight, 0–1. */
  weightShare: number;
  /** `price` against the derived price, as a fraction. */
  deviation: number | null;
  status: SourceStatus;
  /** When the source last quoted, where it says. */
  updatedAt?: string | null;
  /** The exchange a market source trades on ("Binance"). */
  exchange?: string | null;
  /** The market or markets behind it ("SPCXB/USDT"). */
  market?: string | null;
  /** 24h volume in USD behind the price, where known. */
  volume24h?: number | null;
  /** Where to see the source. */
  url?: string | null;
  /**
   * For an aggregate (Atlas), the exchange markets it is built from, as it
   * publishes them. They are listed for reading only: the aggregate is the
   * one source that carries weight.
   */
  components?: DerivedComponent[];
}

export interface DerivedComponent {
  exchange: string;
  market: string;
  price: number | null;
  volume24h: number | null;
  updatedAt: string | null;
  status: string;
  /** Share of the aggregate, 0–1. */
  weighting: number | null;
}

export interface DerivedPrice {
  slug: string;
  name: string;
  /** Derived price for one share, USD. Null when no source could be placed. */
  price: number | null;
  /** Weighted median the outlier band is measured from. */
  centre: number | null;
  /** Weighted standard deviation of included prices, in basis points of `price`. */
  dispersionBps: number | null;
  sourcesUsed: number;
  listed: boolean;
  computedAt: string;
  method: { outlierBand: number; trust: typeof TRUST_TABLE; popularity: typeof POPULARITY };
  sources: DerivedSource[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;
const usd = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;
const ratio = (a: number, b: number) => Math.max(a / b, b / a);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function popularityScore(liquidity: number | null, bonus = 0): number {
  if (liquidity === null || liquidity <= 0) { return Math.min(1, POPULARITY.floor + bonus); }
  const score = (Math.log10(1 + liquidity) - POPULARITY.zeroAt) / POPULARITY.span;
  return Math.min(1, Math.max(POPULARITY.floor, score) + bonus);
}

function dailyVolume(v30: number | null | undefined, v24: number | null | undefined): { value: number | null; note: string } {
  if (v30 !== null && v30 !== undefined && v30 > 0) { return { value: v30 / 30, note: `30d vol ${usd(v30)} / 30` }; }
  if (v24 !== null && v24 !== undefined && v24 > 0) { return { value: v24, note: `24h vol ${usd(v24)}` }; }
  return { value: null, note: "no volume" };
}

function weightedMedian(points: readonly { price: number; weight: number }[]): number | null {
  const usable = points.filter((point) => point.weight > 0).sort((a, b) => a.price - b.price);
  const total = usable.reduce((sum, point) => sum + point.weight, 0);
  if (!usable.length || total <= 0) { return null; }
  let running = 0;
  for (const point of usable) {
    running += point.weight;
    if (running >= total / 2) { return point.price; }
  }
  return usable[usable.length - 1].price;
}

function median(values: readonly number[]): number | null {
  if (!values.length) { return null; }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

type Draft = Omit<DerivedSource, "weight" | "weightShare" | "deviation" | "status" | "trust"> & { trust: number; excluded?: boolean };

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

function perpLiquidity(row: MarketRow): { value: number | null; note: string } {
  const volume = dailyVolume(row.volume30dUsd, row.volume24hUsd);
  const oi = row.openInterestUsd ?? 0;
  if (volume.value === null && oi <= 0) { return { value: null, note: "no volume or open interest" }; }
  const value = (volume.value ?? 0) + (row.marketType === "perp" ? POPULARITY.openInterestShare * oi : 0);
  return { value, note: row.marketType === "perp" && oi > 0 ? `${volume.note} + 0.25 × OI ${usd(oi)}` : volume.note };
}

/**
 * One exchange market as a source. `reference` is the share price the
 * unconfirmed units are checked against; null when there is none.
 */
function marketSource(row: MarketRow, totalShares: number | null, reference: number | null): Draft | null {
  if (row.price === null || row.price <= 0) { return null; }
  const venue = VENUE_NAMES[row.venue] ?? row.venue;
  const kind: SourceClass = row.marketType === "perp" ? "perp" : "spot";
  const liquidity = perpLiquidity(row);
  const base = {
    id: `${row.venue}:${row.marketType}:${row.market}`,
    label: row.label,
    provider: row.provider === venue ? venue : `${row.provider} on ${venue}`,
    kind,
    rawPrice: row.price,
    liquidityUsd: liquidity.value === null ? null : round(liquidity.value, 0),
    liquidityNote: liquidity.note,
    popularity: round(popularityScore(liquidity.value)),
  };
  const placed = (price: number, basis: Basis, rawUnit: string, note: string): Draft => ({
    ...base, price, basis, rawUnit, note, trust: TRUST_TABLE.classes[kind] * TRUST_TABLE.basis[basis],
  });
  const unplaced = (rawUnit: string, note: string): Draft => ({ ...base, price: null, basis: null, rawUnit, note, trust: TRUST_TABLE.classes[kind], excluded: true });

  // A confirmed unit, either stated for this contract or matched to one that is.
  if (row.basis?.kind === "share") {
    return placed(row.price, "share", "one share", "Quotes one share.");
  }
  if (row.basis?.kind === "valuation") {
    if (!totalShares) { return unplaced(`valuation ÷ ${row.basis.notionalShares.toExponential(0)}`, "Quotes a valuation and the company's share count is unknown, so it cannot be put per share."); }
    const valuation = row.price * row.basis.notionalShares;
    return placed(valuation / totalShares, "rescaled", `valuation ÷ ${row.basis.notionalShares.toExponential(0)}`,
      `Quotes valuation in billions: ${row.price.toLocaleString("en-US")} → ${usd(valuation / 1e9)}B ÷ ${(totalShares / 1e9).toFixed(3)}B shares.`);
  }
  if (reference === null) { return unplaced("unconfirmed", "Unit not published, and no share-basis source to check it against."); }

  if (kind === "spot") {
    // Spot tokens track one share by design; far from the reference they are quoting something else.
    return ratio(row.price, reference) <= TOKEN_UNIT_RATIO
      ? placed(row.price, "inferred", "one token", "Spot token, taken as one share (the usual design); unit not published.")
      : unplaced("unconfirmed", `Spot token ${ratio(row.price, reference).toFixed(1)}× from the share price: a different unit.`);
  }
  // An unconfirmed perp: try one share, then the valuation-in-billions design
  // most pre-IPO perps use, and accept whichever lands next to the reference.
  if (ratio(row.price, reference) <= SAME_UNIT_RATIO) {
    return placed(row.price, "inferred", "one share (inferred)", "Unit not published; within 25% of the share price, so taken as one share.");
  }
  if (totalShares) {
    const perShare = (row.price * VALUATION_NOTIONAL) / totalShares;
    if (ratio(perShare, reference) <= SAME_UNIT_RATIO) {
      return placed(perShare, "inferred", "valuation ÷ 1e9 (inferred)",
        `Unit not published; read as valuation in billions (${usd(row.price)}B ÷ ${(totalShares / 1e9).toFixed(3)}B shares) because that lands within 25% of the share price.`);
    }
  }
  return unplaced("unconfirmed", "Unit not published, and neither one share nor valuation-in-billions lands near the share price.");
}

function issuerSource(token: IssuerToken, listed: boolean, reference: number | null, shareCount: { shares: number; from: string } | null): Draft {
  const kind: SourceClass = token.issuer === "OpenStocks" ? "openstocks" : token.issuer === "PreStocks" ? "prestocks" : token.issuer === "Paimon" ? "paimon" : "xstocks";
  const volume = token.volume24h && token.volume24h > 0
    ? { value: token.volume24h, note: `24h vol ${usd(token.volume24h)}` }
    : token.volumeAllTime && token.volumeAllTime > 0
      ? { value: token.volumeAllTime / 365, note: `all-time vol ${usd(token.volumeAllTime)} / 365` }
      : { value: null, note: "no volume" };
  const cap = token.tokenMarketCap ?? 0;
  const liquidity = volume.value === null && cap <= 0 ? null : (volume.value ?? 0) + POPULARITY.tokenCapShare * cap;
  const holdersBonus = token.holders ? POPULARITY.holdersBonus * Math.log10(1 + token.holders) : 0;
  const notes = [volume.note, cap > 0 ? `0.1 × token cap ${usd(cap)}` : null, token.holders ? `${token.holders.toLocaleString("en-US")} holders` : null].filter(Boolean);
  const base = {
    id: `issuer:${token.issuer}:${token.symbol}`,
    label: token.symbol,
    provider: `${token.issuer} · ${token.chain}`,
    kind,
    rawPrice: token.price,
    liquidityUsd: liquidity === null ? null : round(liquidity, 0),
    liquidityNote: notes.join(" + "),
    popularity: round(popularityScore(liquidity, holdersBonus)),
  };
  const isPublicToken = token.name.includes("public token");

  // After a listing, a pre-IPO token is a claim on locked shares and trades at
  // the lock-up discount: a different thing from a share, not a cheap share.
  if (listed && !isPublicToken && token.issuer !== "xStocks") {
    return { ...base, price: null, basis: null, rawUnit: "locked pre-IPO claim", note: "Company has listed: this token is a claim on locked shares and trades at the lock-up discount, so it does not price a share.", trust: TRUST_TABLE.classes[kind], excluded: true };
  }
  if (token.issuer === "Paimon") {
    // Paimon states no shares per token. One token reads as the valuation in
    // billions (CoinMarketCap lists a 1B max supply), put per share with the
    // company's share count: AllocationsX's, else PreStocks' mark valuation ÷ mark price.
    if (!shareCount) {
      return { ...base, price: null, basis: null, rawUnit: "valuation ÷ 1e9", note: "Reads as valuation in billions, and no share count is known to put it per share.", trust: TRUST_TABLE.classes[kind], excluded: true };
    }
    const perShare = (token.price * 1e9) / shareCount.shares;
    return {
      ...base, price: perShare, basis: "inferred", rawUnit: "valuation ÷ 1e9",
      note: `Reads as valuation in billions (unit not published; CMC lists a 1B max supply): $${token.price.toFixed(2)}B ÷ ${(shareCount.shares / 1e6).toFixed(1)}M shares (${shareCount.from}).`,
      trust: TRUST_TABLE.classes[kind] * TRUST_TABLE.basis.inferred,
    };
  }
  const perToken = token.issuer === "OpenStocks" ? OPENSTOCKS_SHARES_PER_TOKEN[token.symbol] : undefined;
  if (perToken === 1) {
    return { ...base, price: token.price, basis: "share", rawUnit: "one share", note: `One ${token.symbol} is one share (OpenStocks).`, trust: TRUST_TABLE.classes[kind] };
  }
  if (perToken) {
    return { ...base, price: token.price / perToken, basis: "rescaled", rawUnit: `${perToken} shares`, note: `One ${token.symbol} is ${perToken} shares (OpenStocks): ${usd(token.price)} ÷ ${perToken}.`, trust: TRUST_TABLE.classes[kind] * TRUST_TABLE.basis.rescaled };
  }
  if (token.issuer === "OpenStocks") {
    // Shares per token are stated only for the tokens above; others are taken as one share when they sit near it.
    if (reference === null || ratio(token.price, reference) > TOKEN_UNIT_RATIO) {
      return { ...base, price: null, basis: null, rawUnit: "unconfirmed", note: "OpenStocks does not state shares per token here, and the price does not sit near one share.", trust: TRUST_TABLE.classes[kind], excluded: true };
    }
    return { ...base, price: token.price, basis: "inferred", rawUnit: "one token (inferred one share)", note: "Shares per token not stated; taken as one share because the price sits near the share price.", trust: TRUST_TABLE.classes[kind] * TRUST_TABLE.basis.inferred };
  }
  return { ...base, price: token.price, basis: "share", rawUnit: "one share", note: `${token.issuer} tokens are one share each.`, trust: TRUST_TABLE.classes[kind] };
}

/** The Atlas aggregate as one source. Its exchanges ride along as `components`. */
function atlasSource(feed: AtlasFeed, reference: number | null): Draft {
  const active = feed.sources.filter((source) => source.status === "active");
  const volume = active.reduce((sum, source) => sum + (source.volume24h ?? 0), 0);
  const age = Date.now() - Date.parse(feed.updatedAt);
  const consensus = feed.consensusScore !== null ? ` Consensus ${feed.consensusStatus?.toLowerCase() ?? "score"} ${feed.consensusScore.toFixed(2)}.` : "";
  const venues = active.map((source) => source.exchange).join(", ");
  const base = {
    id: `atlas:${feed.feedId}`,
    label: `${feed.symbol}/USD`,
    provider: `Atlas oracle · ${feed.feedName}`,
    kind: "atlas" as const,
    rawPrice: feed.price,
    liquidityUsd: volume > 0 ? round(volume, 0) : null,
    liquidityNote: volume > 0 ? `24h vol ${usd(volume)} across ${plural(active.length, "source")}` : "no volume",
    popularity: round(popularityScore(volume > 0 ? volume : null)),
    updatedAt: feed.updatedAt,
    exchange: venues || null,
    market: `${feed.symbol}/USD`,
    volume24h: volume > 0 ? round(volume, 0) : null,
    url: feed.url,
    components: feed.sources.map((source) => ({
      exchange: source.exchange, market: source.market, price: source.price, volume24h: source.volume24h === null ? null : round(source.volume24h, 0),
      updatedAt: source.updatedAt, status: source.status, weighting: source.weighting === null ? null : round(source.weighting),
    })),
  };
  if (!Number.isFinite(age) || age < 0 || age > ATLAS_MAX_AGE_MS) {
    return { ...base, price: null, basis: null, rawUnit: "one token", note: `Atlas has not updated this feed since ${feed.updatedAt}.`, trust: TRUST_TABLE.classes.atlas, excluded: true };
  }
  // Atlas states shares per token on each source; bStocks are one share each.
  if (active.length && active.every((source) => source.sharesPerToken === 1)) {
    return { ...base, price: feed.price, basis: "share", rawUnit: "one share", note: `Volume-weighted across ${venues}; Atlas states one token per share.${consensus}`, trust: TRUST_TABLE.classes.atlas };
  }
  if (reference === null || ratio(feed.price, reference) > TOKEN_UNIT_RATIO) {
    return { ...base, price: null, basis: null, rawUnit: "unconfirmed", note: "Atlas does not state one token per share here, and the price does not sit near one share.", trust: TRUST_TABLE.classes.atlas, excluded: true };
  }
  return { ...base, price: feed.price, basis: "inferred", rawUnit: "one token (inferred one share)", note: `Volume-weighted across ${venues || "its sources"}; shares per token not stated, taken as one share as it sits near the share price.${consensus}`, trust: TRUST_TABLE.classes.atlas * TRUST_TABLE.basis.inferred };
}

/**
 * CoinMarketCap's markets for a company's tokenized shares, one source per
 * token per exchange.
 *
 * Omit pairs already represented by the eligible Atlas aggregate and venues
 * already represented by an eligible direct spot feed.
 */
function cmcSources(assets: CmcAsset[], atlasMarkets: ReadonlySet<string>, coveredSpotVenues: ReadonlySet<string>, reference: number | null): Draft[] {
  return assets.flatMap((asset) => asset.exchanges
    .filter((exchange) => !coveredSpotVenues.has(exchange.exchangeSlug))
    .flatMap((exchange) => {
      const pairs = exchange.pairs.filter((pair) => !atlasMarkets.has(pair.marketId));
      const volume = pairs.reduce((sum, pair) => sum + pair.volume24h, 0);
      if (!pairs.length || volume < CMC_LIMITS.minVolumeUsd) { return []; }
      return [{ exchange, pairs, volume, price: pairs.reduce((sum, pair) => sum + pair.price * pair.volume24h, 0) / volume }];
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, CMC_LIMITS.exchangesPerToken)
    .map(({ exchange, pairs, volume, price }): Draft => {
      const markets = [...new Set(pairs.map((pair) => pair.market))].join(", ");
      const dropped = exchange.pairs.length - pairs.length;
      const base = {
        id: `cmc:${asset.id}:${exchange.exchangeSlug}`,
        label: `${asset.symbol} on ${exchange.exchange}`,
        provider: `${asset.issuer} token · ${exchange.exchange}${exchange.dex ? " (DEX)" : ""}, via CoinMarketCap`,
        kind: "cmc" as const,
        rawPrice: price,
        liquidityUsd: round(volume, 0),
        liquidityNote: `24h vol ${usd(volume)}${pairs.length > 1 ? ` across ${pairs.length} pairs` : ""}`,
        popularity: round(popularityScore(volume)),
        updatedAt: pairs.map((pair) => pair.updatedAt).sort().pop() ?? null,
        exchange: exchange.exchange,
        market: markets,
        volume24h: round(volume, 0),
        url: asset.url,
      };
      const counted = `${dropped ? ` ${plural(dropped, "pair")} left out: already in the Atlas aggregate.` : ""}`;
      const far = reference !== null && ratio(price, reference) > TOKEN_UNIT_RATIO;
      if (far) {
        return { ...base, price: null, basis: null, rawUnit: "unconfirmed", note: `${ratio(price, reference!).toFixed(1)}× from the share price: a different unit.`, trust: TRUST_TABLE.classes.cmc, excluded: true };
      }
      if (asset.oneShare) {
        return { ...base, price, basis: "share", rawUnit: "one share", note: `${asset.issuer} tokens are one share each.${counted}`, trust: TRUST_TABLE.classes.cmc };
      }
      if (reference === null) {
        return { ...base, price: null, basis: null, rawUnit: "unconfirmed", note: "Unit not published, and no share-basis source to check it against.", trust: TRUST_TABLE.classes.cmc, excluded: true };
      }
      return { ...base, price, basis: "inferred", rawUnit: "one token", note: `${asset.issuer} tokenized share, taken as one share (the usual design) as it sits near the share price.${counted}`, trust: TRUST_TABLE.classes.cmc * TRUST_TABLE.basis.inferred };
    }));
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export function derivedPrice(slug: string): Promise<DerivedPrice | null> {
  const company = FEED_ASSETS.find((entry) => entry.slug === slug);
  if (!company) { return Promise.resolve(null); }
  return cached(`derived-price:v6:${slug}`, TTL_SECONDS, () => build(company.slug, company.name));
}

async function build(slug: string, name: string): Promise<DerivedPrice> {
  const listing = LISTED[slug] ?? null;
  const covered = COVERAGE_COMPANIES.some((company) => company.slug === slug);
  const atlasSymbol = ATLAS_SYMBOLS[slug];
  // Each feed is optional: losing one costs its sources, not the price.
  const [coverage, offchain, issuers, ipo, atlas, cmc] = await Promise.all([
    covered ? marketCoverage().catch(() => null) : Promise.resolve(null),
    offchainData([{ slug, name }]).catch(() => null),
    issuerTokens().catch(() => ({} as Record<string, IssuerToken[]>)),
    listing ? postIpo().catch(() => []) : Promise.resolve([]),
    atlasSymbol ? atlasFeed(atlasSymbol).catch(() => null) : Promise.resolve(null),
    cmcCompany(slug).catch(() => [] as CmcAsset[]),
  ]);
  const off: OffchainCompany | undefined = offchain?.companies.get(slug);
  const snapshot = coverage?.companies.find((entry) => entry.slug === slug);
  const tokens = issuers[slug] ?? [];
  const totalShares = off?.totalShares ?? null;
  const listingPrice = ipo.find((entry) => entry.slug === slug)?.sharePrice ?? null;

  const drafts: Draft[] = [];
  if (listing && listingPrice) {
    drafts.push({
      id: "listing", label: `${listing.exchange}: ${listing.ticker}`, provider: "Public share price, as PreStocks quotes it",
      kind: "listing", rawPrice: listingPrice, rawUnit: "one share", price: listingPrice, basis: "share",
      note: `Listed on ${listing.exchange} since ${listing.since}.`, trust: TRUST_TABLE.classes.listing,
      popularity: POPULARITY.listing, liquidityUsd: null, liquidityNote: "Exchange listing: fixed popularity",
    });
  }
  if (off?.price) {
    drafts.push({
      id: "offchain", label: "Off-chain", provider: OFFCHAIN_SOURCE_NAME,
      kind: "offchain", rawPrice: off.price, rawUnit: "one share", price: off.price, basis: "share",
      note: listing ? "Private-market price; trust reduced now that the public market sets the price." : "Price per share from private-market transactions.",
      trust: TRUST_TABLE.classes.offchain * (listing ? TRUST_TABLE.listedOffchain : 1),
      popularity: POPULARITY.offchain, liquidityUsd: null, liquidityNote: "Not an order book: fixed popularity",
    });
  }

  // The share-price reference unconfirmed units are checked against: the
  // listing, else the off-chain price, else the median of share-basis sources.
  const rows = snapshot ? companyView({
    ...snapshot, sector: null, logo: null, offchainPrice: off?.price ?? null, offchainValuation: null, totalShares,
    history: [], series: [], seriesMarket: null, issuers: tokens,
  } satisfies CoverageCompany).rows : [];
  const directShare = [
    ...rows.filter((row) => row.basis?.kind === "share" && row.price).map((row) => row.price!),
    ...tokens.filter((token) => token.issuer !== "OpenStocks" && token.issuer !== "Paimon" && !(listing && token.issuer === "PreStocks")).map((token) => token.price),
  ];
  const reference = listingPrice ?? off?.price ?? median(directShare);

  const coveredSpotVenues = new Set<string>();
  for (const row of rows) {
    const draft = marketSource(row, totalShares, reference);
    if (draft) {
      drafts.push(draft);
      if (draft.kind === "spot" && !draft.excluded) { coveredSpotVenues.add(row.venue); }
    }
  }
  // A share count for valuation-quoted tokens: AllocationsX's, else PreStocks' mark valuation ÷ mark price.
  const prestocksMark = tokens.find((token) => token.issuer === "PreStocks" && token.markValuation && token.markPrice);
  const shareCount = totalShares ? { shares: totalShares, from: "AllocationsX" }
    : prestocksMark ? { shares: prestocksMark.markValuation! / prestocksMark.markPrice!, from: "PreStocks mark valuation ÷ mark price" } : null;
  for (const token of tokens) { drafts.push(issuerSource(token, !!listing, reference, shareCount)); }
  const atlasMarkets = new Set<string>();
  if (atlas) {
    const draft = atlasSource(atlas, reference);
    drafts.push(draft);
    if (!draft.excluded) {
      for (const source of atlas.sources) {
        if (source.marketId) { atlasMarkets.add(source.marketId); }
      }
    }
  }
  drafts.push(...cmcSources(cmc, atlasMarkets, coveredSpotVenues, reference));

  return finish(slug, name, !!listing, drafts);
}

function finish(slug: string, name: string, listed: boolean, drafts: Draft[]): DerivedPrice {
  const candidates = drafts.filter((draft) => !draft.excluded && draft.price !== null && draft.price > 0);
  const rawWeight = (draft: Draft) => draft.trust * draft.popularity;
  const centre = weightedMedian(candidates.map((draft) => ({ price: draft.price!, weight: rawWeight(draft) })));
  const inBand = (draft: Draft) => centre !== null && Math.abs(draft.price! / centre - 1) <= OUTLIER_BAND;
  const kept = candidates.filter(inBand);
  const total = kept.reduce((sum, draft) => sum + rawWeight(draft), 0);
  const price = total > 0 ? kept.reduce((sum, draft) => sum + draft.price! * rawWeight(draft), 0) / total : null;
  const variance = price !== null && total > 0 ? kept.reduce((sum, draft) => sum + rawWeight(draft) * (draft.price! - price) ** 2, 0) / total : null;

  const order: Record<SourceStatus, number> = { included: 0, outlier: 1, excluded: 2 };
  const sources: DerivedSource[] = drafts.map((draft): DerivedSource => {
    const { excluded, ...rest } = draft;
    const status: SourceStatus = excluded || draft.price === null ? "excluded" : kept.includes(draft) ? "included" : "outlier";
    const weight = status === "included" ? rawWeight(draft) : 0;
    const note = status === "outlier" && centre !== null
      ? `${draft.note} Outlier: ${((draft.price! / centre - 1) * 100).toFixed(1)}% from the weighted median, beyond ±${OUTLIER_BAND * 100}%.`
      : draft.note;
    return {
      ...rest,
      note,
      price: draft.price === null ? null : round(draft.price),
      trust: round(draft.trust, 3),
      weight: round(weight),
      weightShare: total > 0 ? round(weight / total) : 0,
      deviation: price !== null && draft.price !== null ? round(draft.price / price - 1) : null,
      status,
    };
  }).sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight || b.trust * b.popularity - a.trust * a.popularity);

  return {
    slug, name, listed,
    price: price === null ? null : round(price),
    centre: centre === null ? null : round(centre),
    dispersionBps: price !== null && variance !== null ? Math.round((Math.sqrt(variance) / price) * 10_000) : null,
    sourcesUsed: kept.length,
    computedAt: new Date().toISOString(),
    method: { outlierBand: OUTLIER_BAND, trust: TRUST_TABLE, popularity: POPULARITY },
    sources,
  };
}
