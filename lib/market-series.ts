/**
 * The market as one series rather than six.
 *
 * Every figure on the overview answers "what is it now". A chart has to answer
 * "what was it", which means folding six companies' recorded prices into one
 * dated line. The recorded points are per company and arrive hourly, so they
 * are bucketed by day and summed across the companies that were covered.
 */

export type PricePoint = {
  at: string;
  price: number;
  volume: number | null;
  venues: number;
};

export type MarketPoint = {
  /** UTC date, YYYY-MM-DD. */
  at: string;
  /** Implied valuation of the whole market: the sum of the constituents'. */
  valuation: number;
  volume: number;
  /** Venue listings quoting the market that day. */
  venues: number;
  /** How many companies the point covers, so partial days are visible. */
  constituents: number;
  /** The same total rebased to 100 at the start of the window. */
  index: number;
};

/** One company's own history, the only level at which these figures are sound. */
export type CompanyPoint = {
  at: string;
  price: number;
  volume: number;
  venues: number;
  /** price x the contracts behind it. Null when the venues state no valuation. */
  valuation: number | null;
  /** The price rebased to 100 at the start of the window. */
  index: number;
};

/**
 * One company's recorded history as a daily series.
 *
 * Valuation is the recorded price times `basis` -- the contracts the venues
 * write these perpetuals against, which `valuationBasis` reads back off
 * today's published figure. It is a notional billion, not a cap table, so a
 * real share count has no part in it.
 *
 * Taking the basis from the live reading rather than fixing it at 1e9 is what
 * makes the last point of the line equal the figure printed above it: both
 * are the venues' volume-weighted valuation, one of them rearranged. Null
 * where no venue states a valuation, rather than guessed.
 */
export function companySeries(history: readonly PricePoint[], basis: number | null): CompanyPoint[] {
  const days = byDay(history);
  const dates = [...days.keys()].sort();
  if (!dates.length) { return []; }
  const base = days.get(dates[0])!.price;
  return dates.map((date) => {
    const point = days.get(date)!;
    return {
      at: date,
      price: point.price,
      volume: point.volume ?? 0,
      venues: point.venues,
      valuation: basis && basis > 0 ? point.price * basis : null,
      index: base > 0 ? (point.price / base) * 100 : 100,
    };
  });
}

/** Rebases a company window to 100 at its own first point. */
export function rebaseCompany(points: readonly CompanyPoint[]): CompanyPoint[] {
  const base = points[0]?.price ?? 0;
  if (base <= 0) { return [...points]; }
  return points.map((point) => ({ ...point, index: (point.price / base) * 100 }));
}

export type Constituent = {
  slug: string;
  /** What the company is worth now, as the feed reports it. */
  valuation: number | null;
  history: readonly PricePoint[];
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * One point per UTC day, the last of that day.
 *
 * The ingest runs hourly, so a day holds up to 24 readings. The last is the
 * close, which is what a daily chart means everywhere else.
 */
export function byDay(points: readonly PricePoint[]): Map<string, PricePoint> {
  const buckets = new Map<string, PricePoint>();
  for (const point of points) {
    if (!Number.isFinite(point.price) || point.price <= 0) { continue; }
    const key = day(point.at);
    const held = buckets.get(key);
    if (!held || point.at > held.at) { buckets.set(key, point); }
  }
  return buckets;
}

/**
 * The market's own history, oldest first.
 *
 * Each company's valuation is carried back through its own price: what it is
 * worth now, scaled by how its price has moved. Not price x shares -- the
 * feed's valuation is not that product (two companies have no share count at
 * all, and for the ones that do the two disagree), so multiplying would draw
 * a line that ends somewhere other than the figure at the top of the page.
 * Scaling ends on the published total by construction.
 *
 * Starts where every constituent has a price. A company that listed later
 * cannot contribute to days before it had one, and letting the total grow as
 * companies joined would draw a rising market out of a lengthening list --
 * the same reason the index truncates to its shortest series.
 *
 * Inside that window a missing day carries the company's last known price
 * forward. A venue read that failed at 3am is not the market losing a
 * constituent for a day, and dipping the total would say that it was.
 */
export function marketSeries(companies: readonly Constituent[]): MarketPoint[] {
  const usable = companies
    .map((company) => {
      const days = byDay(company.history);
      const dates = [...days.keys()].sort();
      // Paired with the last recorded price rather than the live one: the
      // ratio has to be internally consistent or the final point drifts off
      // the published figure by whatever moved since the last reading.
      const latest = dates.length ? days.get(dates[dates.length - 1])!.price : null;
      return { ...company, days, perPrice: latest && latest > 0 ? (company.valuation ?? 0) / latest : 0 };
    })
    .filter((company) => (company.valuation ?? 0) > 0 && company.perPrice > 0 && company.days.size > 0);
  if (!usable.length) { return []; }

  const firstDays = usable.map((company) => [...company.days.keys()].sort()[0]);
  const start = firstDays.reduce((latest, first) => (first > latest ? first : latest));
  const dates = [...new Set(usable.flatMap((company) => [...company.days.keys()]))]
    .filter((date) => date >= start)
    .sort();

  const carried = new Map<string, PricePoint>();
  const points = dates.map((date) => {
    let valuation = 0;
    let volume = 0;
    let venues = 0;
    let constituents = 0;
    for (const company of usable) {
      const point = company.days.get(date) ?? carried.get(company.slug);
      if (!point) { continue; }
      carried.set(company.slug, point);
      valuation += point.price * company.perPrice;
      volume += point.volume ?? 0;
      venues += point.venues;
      constituents += 1;
    }
    return { at: date, valuation, volume, venues, constituents };
  });

  const base = points[0]?.valuation ?? 0;
  return points.map((point) => ({ ...point, index: base > 0 ? (point.valuation / base) * 100 : 100 }));
}

/**
 * Rebases a window to 100 at its own first point.
 *
 * The series carries an index against the whole recorded history, but the
 * page shows a slice of it. Left alone, picking "30D" draws a line that opens
 * at 127 because that is where it stood ninety days ago -- the number and the
 * range label would be describing different windows.
 */
export function rebase(points: readonly MarketPoint[]): MarketPoint[] {
  const base = points[0]?.valuation ?? 0;
  if (base <= 0) { return [...points]; }
  return points.map((point) => ({ ...point, index: (point.valuation / base) * 100 }));
}

/** Change between the ends of a series, as a fraction. */
export function seriesChange(points: readonly MarketPoint[], pick: (point: MarketPoint) => number): number | null {
  if (points.length < 2) { return null; }
  const first = pick(points[0]);
  const last = pick(points[points.length - 1]);
  return first > 0 ? last / first - 1 : null;
}

/**
 * How the market's value is split, largest first.
 *
 * The concentration figure on the overview says the top two hold 86% of it;
 * this is the whole breakdown behind that number.
 */
export function shareOfMarket<T extends { valuation: number | null }>(
  companies: readonly T[],
): Array<T & { share: number }> {
  const total = companies.reduce((sum, company) => sum + (company.valuation ?? 0), 0);
  return companies
    .filter((company) => (company.valuation ?? 0) > 0)
    .map((company) => ({ ...company, share: total > 0 ? (company.valuation ?? 0) / total : 0 }))
    .sort((a, b) => b.share - a.share);
}

/** Totals by sector, largest first; companies without one are grouped. */
export function bySector<T extends { sector: string | null; valuation: number | null; referenceVolume: number | null }>(
  companies: readonly T[],
): Array<{ sector: string; valuation: number; volume: number; count: number; share: number }> {
  const groups = new Map<string, { valuation: number; volume: number; count: number }>();
  for (const company of companies) {
    const key = company.sector ?? "Unclassified";
    const held = groups.get(key) ?? { valuation: 0, volume: 0, count: 0 };
    held.valuation += company.valuation ?? 0;
    held.volume += company.referenceVolume ?? 0;
    held.count += 1;
    groups.set(key, held);
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.valuation, 0);
  return [...groups.entries()]
    .map(([sector, group]) => ({ sector, ...group, share: total > 0 ? group.valuation / total : 0 }))
    .sort((a, b) => b.valuation - a.valuation);
}
