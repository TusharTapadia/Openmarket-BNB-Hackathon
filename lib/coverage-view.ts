import type { CoverageCompanySnapshot, CoverageMarket, DailyClose } from "@/lib/market-coverage";
import type { IssuerToken } from "@/lib/issuers";
import type { ValuationBasis } from "@/lib/offchain";

export type { IssuerToken } from "@/lib/issuers";

/**
 * The figures both pages read off a company's markets, worked out in one place
 * so the overview row and the company page cannot disagree.
 */

export type { CoverageMarket } from "@/lib/market-coverage";

export interface CoverageCompany extends CoverageCompanySnapshot {
  sector: string | null;
  logo: string | null;
  /** Off-chain price for one share. */
  offchainPrice: number | null;
  /** Off-chain valuation of the whole company. */
  offchainValuation: number | null;
  /** How `offchainValuation` was worked out: current price × total shares, or the last priced round. */
  offchainValuationBasis?: ValuationBasis | null;
  /** The last priced round's valuation, kept when `offchainValuation` is price × shares. */
  lastRoundValuation?: number | null;
  totalShares: number | null;
  /** The last eight daily closes of the lead market, oldest first. */
  history: number[];
  /** Up to 90 daily closes of the lead market, oldest first. */
  series: DailyClose[];
  /** Which market `series` comes from. */
  seriesMarket: { label: string; venue: string; provider: string } | null;
  /** Other issuers' tokenized versions of the company. */
  issuers: IssuerToken[];
}

export interface CoveragePayload {
  fetchedAt: string;
  updatedAt: string;
  offchainAsOf: string | null;
  failedSources: number;
  companies: CoverageCompany[];
}

export type AssetType = "perp" | "spot";

export const TYPE_INFO: Record<AssetType, { tag: string; name: string; tagClass: string; colour: string; description: string }> = {
  perp: {
    tag: "PERP", name: "Perpetuals", tagClass: "cex", colour: "var(--series-2)",
    description: "Leveraged contracts that track the company's implied price. Cash-settled with funding payments; no underlying shares.",
  },
  spot: {
    tag: "SPOT", name: "Spot tokens", tagClass: "dex", colour: "var(--series-4)",
    description: "Tokens you hold outright, issued against a wrapper or SPV. Transferable on-chain.",
  },
};

export const VENUE_NAMES: Record<string, string> = {
  hyperliquid: "Hyperliquid", aster: "Aster", binance: "Binance", okx: "OKX",
  mexc: "MEXC", bitget: "Bitget", kucoin: "KuCoin", gate: "Gate",
};

/** How far from the lead market a quote may sit before it is a different unit, not a different price. */
const BASIS_RATIO = 3;

/**
 * What a contract's price measures.
 *
 * Pre-IPO perpetuals mostly price the company's expected valuation divided by
 * a notional share count, not a share: Binance's OPENAIUSDT states 1 billion,
 * so $1,228 reads as a ~$1.23T valuation. A few quote one real share. Treating
 * the two alike compares a valuation to a share price.
 */
export type PriceBasis =
  | { kind: "valuation"; notionalShares: number }
  | { kind: "share" };

/**
 * Contracts whose basis is confirmed by the venue or the contract's issuer.
 * Only these anchor a company's implied valuation; anything unconfirmed is
 * shown as unknown rather than guessed.
 */
export const CONFIRMED_BASIS: { companySlug: string; venue: string; label: string; basis: PriceBasis; source: string }[] = [
  // Binance lists an estimated share count of 1 billion on the contract.
  { companySlug: "openai", venue: "binance", label: "OPENAIUSDT", basis: { kind: "valuation", notionalShares: 1e9 }, source: "https://www.tokenpost.com/news/investing/53834" },
  // trade.xyz: one unit is one Anthropic Class A share.
  { companySlug: "anthropic", venue: "hyperliquid", label: "xyz:ANT", basis: { kind: "share" }, source: "https://perpys.com/markets/ant/" },
  // EntropyIO: linked to Anthropic's valuation, quoted in billions ($1,466.8 ~ $1.47T).
  { companySlug: "anthropic", venue: "hyperliquid", label: "io:ANTH", basis: { kind: "valuation", notionalShares: 1e9 }, source: "https://www.redstone.finance/blog/redstone-live-powers-entropy-pre-ipo-and-rwa-markets-on-hyperliquid/" },
];

/**
 * A perp quoting within this ratio of a confirmed contract for the same
 * company is taken to share its unit: venues quoting the same contract design
 * sit within a few percent of each other, and a different unit is out by an
 * order of magnitude.
 */
const SAME_UNIT_RATIO = 1.25;

/**
 * Companies that have since listed publicly. Their off-chain figures are stale unless the valuation is taken from a current off-chain price (see `offchainValuationBasis`).
 *
 * Not every entry is a covered company (COVERAGE_COMPANIES): SpaceX listed
 * before it was covered and is here for the Pre-IPO → IPO page and the derived
 * price only, so it carries its own `name`. Code that joins LISTED to covered
 * companies must fall back to `name` when the join finds nothing.
 */
export const LISTED: Record<string, { exchange: string; ticker: string; since: string; source: string; name?: string }> = {
  anthropic: { exchange: "Nasdaq", ticker: "ANT", since: "2026-11-19", source: "https://www.nasdaqtrader.com/TraderNews.aspx?id=DTN2026-28" },
  // First trade Friday 12 June 2026 on Nasdaq at a $135 offer price (NPR, 12 June 2026).
  spacex: { exchange: "Nasdaq", ticker: "SPCX", since: "2026-06-12", source: "https://www.npr.org/2026/06/12/nx-s1-5855004/stock-ai-spacex-ipo-elon-musk", name: "SpaceX" },
};

function basisFor(companySlug: string, market: CoverageMarket, anchors: readonly { price: number; basis: PriceBasis }[]): PriceBasis | null {
  const confirmed = CONFIRMED_BASIS.find((entry) => entry.companySlug === companySlug && entry.venue === market.venue && entry.label === market.label);
  if (confirmed) { return confirmed.basis; }
  if (market.marketType !== "perp" || market.price === null || market.price <= 0) { return null; }
  const near = anchors.find((anchor) => Math.max(market.price! / anchor.price, anchor.price / market.price!) <= SAME_UNIT_RATIO);
  return near ? near.basis : null;
}

function median(values: readonly number[]): number | null {
  if (!values.length) { return null; }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface MarketRow extends CoverageMarket {
  /** Quoted on a different unit basis from the lead market, so left out of the median. */
  offBasis: boolean;
  /** What the price measures, when confirmed (directly or by matching a confirmed contract). */
  basis: PriceBasis | null;
  /** The company valuation this market's price implies, when its basis is known. */
  impliedValuation: number | null;
}

export interface CompanyView extends CoverageCompany {
  rows: MarketRow[];
  main: MarketRow[];
  off: MarketRow[];
  /** Median price across markets on the main basis. */
  price: number | null;
  low: number | null;
  high: number | null;
  /** How many times the main price the off-basis markets quote. */
  offRatio: number | null;
  /** Open-interest-weighted annualized funding across perps that report it. */
  funding: number | null;
  perps: number;
  venues: string[];
  types: AssetType[];
  /**
   * Market-implied valuation against the off-chain valuation, as a fraction.
   * Null when no market's basis is confirmed, or the company has listed.
   */
  premium: number | null;
  /** Median valuation implied by the markets whose price basis is confirmed. */
  impliedValuation: number | null;
  /** `impliedValuation` per real share, for comparing with a share price. */
  impliedSharePrice: number | null;
  /** How many markets the implied valuation is drawn from. */
  valuedMarkets: number;
  /** Set once the company has listed publicly. */
  listed: (typeof LISTED)[string] | null;
}

export function companyView(company: CoverageCompany): CompanyView {
  const priced = company.markets.filter((market) => market.price !== null && market.price > 0);
  // The lead is the market with the most volume; its price sets the basis.
  const lead = [...priced].sort((a, b) => (b.volume30dUsd ?? b.volume24hUsd ?? 0) - (a.volume30dUsd ?? a.volume24hUsd ?? 0))[0];
  const anchors = company.markets.flatMap((market) => {
    const confirmed = CONFIRMED_BASIS.find((entry) => entry.companySlug === company.slug && entry.venue === market.venue && entry.label === market.label);
    return confirmed && market.price !== null && market.price > 0 ? [{ price: market.price, basis: confirmed.basis }] : [];
  });
  const rows: MarketRow[] = company.markets.map((market) => {
    const basis = basisFor(company.slug, market, anchors);
    const impliedValuation = market.price === null || market.price <= 0 || basis === null ? null
      : basis.kind === "valuation" ? market.price * basis.notionalShares
      : company.totalShares ? market.price * company.totalShares : null;
    return {
      ...market,
      offBasis: !!lead && market.price !== null && market.price > 0
        && (market.price / lead.price! > BASIS_RATIO || lead.price! / market.price > BASIS_RATIO),
      basis,
      impliedValuation,
    };
  });
  const main = rows.filter((row) => !row.offBasis);
  const off = rows.filter((row) => row.offBasis);
  const mainPrices = main.flatMap((row) => (row.price !== null && row.price > 0 ? [row.price] : []));
  const offPrices = off.flatMap((row) => (row.price !== null && row.price > 0 ? [row.price] : []));
  const price = median(mainPrices);
  const offMedian = median(offPrices);

  const weighted = rows.filter((row) => row.marketType === "perp" && row.fundingRateAnnualized !== null && (row.openInterestUsd ?? 0) > 0);
  const weight = weighted.reduce((total, row) => total + row.openInterestUsd!, 0);
  const funding = weight > 0 ? weighted.reduce((total, row) => total + row.fundingRateAnnualized! * row.openInterestUsd!, 0) / weight : null;

  const venues = [...new Set(rows.map((row) => row.venue))];
  // An issuer's token (OpenStocks, PreStocks, xStocks) is a spot asset too.
  const types = (["perp", "spot"] as const).filter((type) => rows.some((row) => row.marketType === type) || (type === "spot" && company.issuers.length > 0));
  // Valuation against valuation: a perp's price is not a share price.
  const valuations = rows.flatMap((row) => (row.impliedValuation !== null ? [row.impliedValuation] : []));
  const impliedValuation = median(valuations);
  const listed = LISTED[company.slug] ?? null;
  // A listed company's off-chain figures are stale unless its valuation is
  // worked out from a current off-chain price, in which case the comparison
  // means something again.
  const offchainCurrent = !listed || company.offchainValuationBasis === "price × shares";
  const premium = offchainCurrent && impliedValuation !== null && company.offchainValuation ? impliedValuation / company.offchainValuation - 1 : null;

  return {
    ...company,
    rows, main, off, price,
    low: mainPrices.length ? Math.min(...mainPrices) : null,
    high: mainPrices.length ? Math.max(...mainPrices) : null,
    offRatio: price !== null && offMedian !== null ? offMedian / price : null,
    funding,
    perps: rows.filter((row) => row.marketType === "perp").length,
    venues,
    types,
    premium,
    impliedValuation,
    impliedSharePrice: impliedValuation !== null && company.totalShares ? impliedValuation / company.totalShares : null,
    valuedMarkets: valuations.length,
    listed,
  };
}

/** "$4.6B", "$12K", or a dash. */
export function compactUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) { return "—"; }
  const size = Math.abs(value);
  const [divisor, unit] = size >= 1e12 ? [1e12, "T"] : size >= 1e9 ? [1e9, "B"] : size >= 1e6 ? [1e6, "M"] : size >= 1e3 ? [1e3, "K"] : [1, ""];
  const scaled = value / divisor;
  return `$${unit && Math.abs(scaled) < 10 ? scaled.toFixed(1) : Math.round(scaled).toLocaleString("en-US")}${unit}`;
}

/** A market price: cents above a dollar, four places below one. */
export function marketPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) { return "—"; }
  const digits = value >= 1 ? 2 : 4;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** "+5.5%", "−9.2%", "0.0%" or a dash for a funding rate given as a fraction per year. */
/**
 * A spot price against the off-chain price for one share: positive is a
 * premium, negative a discount. Spot tokens and issuer tokens track one share,
 * so the two compare directly; a price more than three times away is taken to
 * be quoting another unit and gives null rather than a meaningless gap.
 */
export function spotPremium(price: number | null | undefined, company: { offchainPrice: number | null }): number | null {
  if (!price || !company.offchainPrice || price <= 0) { return null; }
  const ratio = price / company.offchainPrice;
  return ratio > 3 || ratio < 1 / 3 ? null : ratio - 1;
}

export function fundingText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) { return "—"; }
  const percent = value * 100;
  if (Math.abs(percent) < 0.05) { return "0.0%"; }
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`;
}

/** "5 markets", "1 venue", "4 companies". */
export function plural(count: number, word: string): string {
  if (count === 1) { return `${count} ${word}`; }
  return `${count} ${/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`}`;
}
