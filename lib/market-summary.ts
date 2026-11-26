import { premium, type Company } from "@/app/data";

/**
 * The figures the overview's summary tiles and panels are built from.
 *
 * Derived in one place rather than inline in the page: several of them are the
 * same traversal of the same list, and the tiles and the panels below them have
 * to agree -- a sector total that did not add up to the headline valuation
 * would be the kind of discrepancy nobody can explain later.
 */

export interface Segment {
  slug: string;
  name: string;
  value: number;
  share: number;
}

export interface SectorRow {
  name: string;
  value: number;
  share: number;
  count: number;
  priced: number;
}

export interface MarketSummary {
  /** Share of the total implied valuation held by the two largest companies. */
  topShare: number | null;
  /** Companies no venue quotes, so they have a mark but no reference price. */
  unpriced: number;
  /** Median of reference ÷ mark − 1 across companies quoting both. */
  medianPremium: number | null;
  above: number;
  below: number;
  /** Perpetual venue listings across every company. */
  venues: number;
  /** Companies quoted on ten venues or more. */
  deep: number;
  segments: Segment[];
  sectors: SectorRow[];
  totalValuation: number;
}

/** Companies with a valuation, largest first. Everything below ranks on this. */
function valuedCompanies(companies: readonly Company[]): Company[] {
  return companies
    .filter((company) => company.valuation !== null && company.valuation > 0)
    .sort((a, b) => (b.valuation ?? 0) - (a.valuation ?? 0));
}

function median(values: readonly number[]): number | null {
  if (!values.length) { return null; }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // An even count takes the midpoint of the two central values rather than
  // whichever happened to land on the right of the split.
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function marketSummary(companies: readonly Company[]): MarketSummary {
  const valued = valuedCompanies(companies);
  const totalValuation = valued.reduce((sum, company) => sum + (company.valuation ?? 0), 0);

  const premiums = companies.flatMap((company) => {
    const value = premium(company);
    return value === null ? [] : [value];
  });

  const sectorTotals = new Map<string, SectorRow>();
  for (const company of companies) {
    const name = company.sector ?? "Unclassified";
    const row = sectorTotals.get(name) ?? { name, value: 0, share: 0, count: 0, priced: 0 };
    row.value += company.valuation ?? 0;
    row.count += 1;
    if (company.price !== null) { row.priced += 1; }
    sectorTotals.set(name, row);
  }

  const share = (value: number) => (totalValuation > 0 ? value / totalValuation : 0);

  return {
    topShare: valued.length >= 2 && totalValuation > 0
      ? (valued[0].valuation! + valued[1].valuation!) / totalValuation
      : null,
    unpriced: companies.filter((company) => company.price === null).length,
    medianPremium: median(premiums),
    above: premiums.filter((value) => value > 0).length,
    below: premiums.filter((value) => value < 0).length,
    venues: companies.reduce((sum, company) => sum + company.referenceVenues, 0),
    deep: companies.filter((company) => company.referenceVenues >= 10).length,
    segments: valued.map((company) => ({
      slug: company.slug,
      name: company.name,
      value: company.valuation ?? 0,
      share: share(company.valuation ?? 0),
    })),
    sectors: [...sectorTotals.values()]
      .map((row) => ({ ...row, share: share(row.value) }))
      .sort((a, b) => b.value - a.value),
    totalValuation,
  };
}

/**
 * The most recently disclosed round per company, newest first.
 *
 * Companies without a dated round are left out rather than sorted to the end:
 * the panel is a list of what happened recently, and a row with no date is not
 * an answer to that.
 */
export function latestRounds(companies: readonly Company[], limit = 5): Company[] {
  return companies
    .filter((company) => company.roundDate !== null && company.round !== null)
    .sort((a, b) => (b.roundDate ?? "").localeCompare(a.roundDate ?? ""))
    .slice(0, limit);
}

/** "3 months ago" for a disclosed round, which is how old these dates read. */
export function relativeAge(date: string | null): string | null {
  if (!date) { return null; }
  const then = Date.parse(date);
  if (!Number.isFinite(then)) { return null; }
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 0) { return null; }
  if (days < 30) { return days <= 1 ? "today" : `${days}d ago`; }
  const months = Math.round(days / 30.44);
  if (months < 18) { return `${months}mo ago`; }
  return `${(days / 365.25).toFixed(1)}y ago`;
}

export interface VenueSlice {
  name: string;
  volume: number;
  openInterest: number;
  type: "CEX" | "DEX";
}

export interface Derivatives {
  openInterest: number;
  volume: number;
  /** Deepest venues by volume, for the breakdown chart. */
  venues: VenueSlice[];
  cexVolume: number;
  dexVolume: number;
  /** Venues where longs pay shorts, which is the market leaning long. */
  longPaying: number;
  shortPaying: number;
  venueCount: number;
}

/**
 * The perpetual market as one set of figures.
 *
 * Aggregated across every company rather than per company: the overview asks
 * how big and how one-sided this market is, which is not a question about any
 * single name. Volume and open interest are already in dollars by the time
 * they reach here, having been converted at whichever venue reported them.
 */
export function derivativesSummary(
  perpetualsBySlug: Iterable<{ perpetuals?: { exchangeName: string | null; exchangeType: string | null; volume: number | null; openInterest: number | null; annualizedFundingRate: number | null }[] }>,
): Derivatives {
  const byVenue = new Map<string, VenueSlice>();
  let longPaying = 0;
  let shortPaying = 0;
  let venueCount = 0;

  for (const entry of perpetualsBySlug) {
    for (const perp of entry.perpetuals ?? []) {
      const name = perp.exchangeName;
      if (!name) { continue; }
      venueCount += 1;
      // Funding is positive when longs pay shorts, which is the side of the
      // book that is crowded -- the one figure here that carries a direction.
      if ((perp.annualizedFundingRate ?? 0) > 0) { longPaying += 1; }
      else if ((perp.annualizedFundingRate ?? 0) < 0) { shortPaying += 1; }

      const slice = byVenue.get(name) ?? { name, volume: 0, openInterest: 0, type: perp.exchangeType === "DEX" ? "DEX" : "CEX" };
      slice.volume += perp.volume ?? 0;
      slice.openInterest += perp.openInterest ?? 0;
      byVenue.set(name, slice);
    }
  }

  const venues = [...byVenue.values()].sort((a, b) => b.volume - a.volume);
  return {
    openInterest: venues.reduce((sum, venue) => sum + venue.openInterest, 0),
    volume: venues.reduce((sum, venue) => sum + venue.volume, 0),
    venues: venues.slice(0, 8),
    cexVolume: venues.filter((venue) => venue.type === "CEX").reduce((sum, venue) => sum + venue.volume, 0),
    dexVolume: venues.filter((venue) => venue.type === "DEX").reduce((sum, venue) => sum + venue.volume, 0),
    longPaying,
    shortPaying,
    venueCount,
  };
}

/**
 * A valuation-weighted index of the companies tracked, based at 100.
 *
 * One number for "how is this market doing", which a list of six prices is not.
 * Weighted by valuation so the index moves with the market's own shape rather
 * than treating a $24B company and a $2T one as equals, and rebased to 100 at
 * the start of the window so the line is readable whatever the prices are.
 */
export function valuationIndex(
  companies: readonly { history: number[]; valuation: number | null }[],
): { series: number[]; change: number | null } {
  const usable = companies.filter((company) => company.history.length >= 2 && (company.valuation ?? 0) > 0);
  if (!usable.length) { return { series: [], change: null }; }

  // Only as long as the shortest series: a company that listed later cannot
  // contribute to days before it had a price without inventing one.
  const length = Math.min(...usable.map((company) => company.history.length));
  const weight = usable.reduce((sum, company) => sum + (company.valuation ?? 0), 0);

  const series = Array.from({ length }, (_, step) => {
    const weighted = usable.reduce((sum, company) => {
      const history = company.history.slice(-length);
      return sum + (history[step] / history[0]) * (company.valuation ?? 0);
    }, 0);
    return (weighted / weight) * 100;
  });

  const change = series.length >= 2 ? series[series.length - 1] / series[0] - 1 : null;
  return { series, change };
}

/** Share of priced companies that rose over the window, as a 0–1 fraction. */
export function breadth(companies: readonly { history: number[] }[], back: number): { up: number; down: number; share: number | null } {
  const moves = companies.flatMap((company) => {
    if (company.history.length < 2) { return []; }
    const latest = company.history[company.history.length - 1];
    const earlier = company.history[Math.max(company.history.length - 1 - back, 0)];
    return earlier > 0 ? [latest / earlier - 1] : [];
  });
  const up = moves.filter((move) => move > 0).length;
  const down = moves.filter((move) => move < 0).length;
  return { up, down, share: moves.length ? up / moves.length : null };
}
