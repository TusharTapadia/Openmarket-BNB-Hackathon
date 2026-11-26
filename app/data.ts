export type Company = {
  id: string;
  slug: string;
  name: string;
  sector: string | null;
  logo: string | null;
  price: number | null;
  markPrice: number | null;
  referenceVenues: number;
  referenceVolume: number | null;
  /** Venues dropped from the price mean for quoting a mismatched contract size. */
  referenceExcluded: number;
  valuation: number | null;
  shares: number | null;
  round: string | null;
  roundDate: string | null;
  founded: string | null;
  headquarters: string | null;
  website: string | null;
  description: string | null;
  /** Recent daily reference prices, oldest first. Empty when none are recorded. */
  history: number[];
};

export type MarketData = {
  derivatives?: import("@/lib/market-summary").Derivatives;
  companies: Company[];
  fetchedAt: string;
  profileUnavailable: boolean;
};

export type FundingRound = {
  id: string;
  name: string | null;
  amount: number | null;
  valuation: number | null;
  date: string | null;
  investor: string | null;
  status: string | null;
};
export type Article = {
  id: string;
  title: string;
  source: string | null;
  date: string | null;
  url: string | null;
};
export type CompanyInsights = {
  funding: FundingRound[];
  news: Article[];
  research: Article[];
};

export function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2,
  }).format(value);
}

export function formatPrice(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

/**
 * Reference price against the reference mark, as a fraction.
 *
 * Positive means the perpetual market prices the company above where we mark
 * it. Null unless both numbers exist and the mark is usable as a denominator,
 * because a premium computed against a missing mark is not a small number --
 * it is a meaningless one.
 */
export function premium(company: Pick<Company, "price" | "markPrice">): number | null {
  const { price, markPrice } = company;
  if (price === null || markPrice === null || !(markPrice > 0)) { return null; }
  return price / markPrice - 1;
}

/** "62%" — a share of a whole, where the sign carries no meaning. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) { return "—"; }
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

/** "+4.2%" — a move or a difference, where the sign is the point. */
export function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) { return "—"; }
  const percent = value * 100;
  const digits = Math.abs(percent) >= 10 ? 1 : 2;
  return `${percent >= 0 ? "+" : "−"}${Math.abs(percent).toFixed(digits)}%`;
}

/**
 * Change between the latest price and the one `back` days before it.
 *
 * Measured off the end of the series rather than by date, because the series is
 * already daily and a gap in it means the market did not report, not that the
 * price held. Null when there is nothing to compare against -- a company with
 * one point has no change, which is different from a change of zero.
 */
export function changeOver(history: readonly number[], back: number): number | null {
  if (history.length < 2) { return null; }
  const latest = history[history.length - 1];
  const earlier = history[Math.max(history.length - 1 - back, 0)];
  if (!(earlier > 0) || !(latest > 0) || earlier === latest) { return earlier === latest ? 0 : null; }
  return latest / earlier - 1;
}
