import type { Company, FundingRound } from "@/app/data";
import type { Perp } from "@/app/perps";

/**
 * Per-company market data — priced funding rounds, perpetual futures listed on
 * other venues, and other issuers' tokens on the same company.
 *
 * This used to be six JSON files compiled into the bundle, which meant a wrong
 * figure could only be corrected by editing source and redeploying. It now
 * comes from the market data API, which reads it out of Postgres, so a
 * correction is a write rather than a release.
 *
 * The payload shape is unchanged from those files on purpose: the transforms
 * below are the ones that always ran, and keeping the contract identical meant
 * the move could be a change of source rather than a rewrite.
 */

export type JsonRound = { series: string | null; date: string | null; amountRaised: number | null; valuation: number | null };
export type JsonPerp = {
  exchangeName: string | null; exchangeType: string | null; platformSlug: string | null; price: number | null;
  /** Absent until the API serving them is deployed; see normalized() below. */
  priceScale?: number | null; normalizedPrice?: number | null;
  estimatedValuation: number | null; openInterest: number | null; volume: number | null;
  annualizedFundingRate: number | null; tradeUrl: string | null; defillamaContract: string | null;
  quotedAt?: string | null;
};
export type TokenIssuer = {
  issuerName: string | null; issuerSlug: string | null; backing: string | null; price: number | null;
  marketCap: number | null; estimatedValuation: number | null; productUrl: string | null;
  /**
   * When the issuer last moved this price. Not when we last read it: Colb's
   * token is a NAV certificate whose aggregator has not published since June,
   * so that row is both current and months old.
   */
  priceUpdatedAt?: string | null;
  /**
   * Our own row, priced live from the token rather than from the stored
   * snapshot the other issuers' figures come from. Optional so a payload from
   * an API that predates it reads as "none of these are ours", which is what
   * the table showed before.
   */
};
export type CompanyMarketData = { company: string; slug: string; fundingRounds: JsonRound[]; perpetuals: JsonPerp[]; tokenIssuers: TokenIssuer[] };

/** Turns a company name (or alias) into the slug the data uses. */
export const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Funding rounds in the insights shape, newest first; priced rounds count as completed. */
export function fundingRounds(entry: CompanyMarketData | undefined, slug: string): FundingRound[] {
  return [...(entry?.fundingRounds ?? [])]
    .map((round, index) => ({
      id: `${slug}-round-${index}`,
      name: round.series,
      amount: round.amountRaised,
      valuation: round.valuation,
      date: round.date,
      investor: null,
      status: "COMPLETED",
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}

/** Perpetual venues for the company. Rows missing a price or venue are left out. */
export function perpetuals(entry: CompanyMarketData | undefined, slug: string): Perp[] {
  if (!entry) return [];
  return entry.perpetuals.flatMap((row) =>
    row.exchangeName && row.price !== null && row.tradeUrl
      ? [{
          company: entry.company,
          slug,
          exchangeName: row.exchangeName,
          exchangeType: row.exchangeType === "DEX" ? "DEX" : "CEX",
          platformSlug: row.platformSlug ?? slugify(row.exchangeName),
          price: row.price,
          normalizedPrice: normalized(row) ?? row.price,
          priceScale: row.priceScale ?? 1,
          quotedAt: row.quotedAt ?? null,
          estimatedValuation: row.estimatedValuation ?? 0,
          openInterest: row.openInterest,
          volume: row.volume ?? 0,
          annualizedFundingRate: row.annualizedFundingRate ?? 0,
          tradeUrl: row.tradeUrl,
        } satisfies Perp]
      : [],
  );
}

export function tokenIssuers(entry: CompanyMarketData | undefined): TokenIssuer[] {
  return entry?.tokenIssuers ?? [];
}

/**
 * Logos in public/logos, used when the company profile has none (Anduril's
 * profile carries no logo_url) or omits it.
 */
const LOCAL_LOGOS: Record<string, string> = {
  anduril: "/logos/anduril.png",
  anthropic: "/logos/anthropic.png",
  databricks: "/logos/databricks.svg",
  "figure-ai": "/logos/figure-ai.svg",
  kalshi: "/logos/kalshi.png",
  neuralink: "/logos/neuralink.png",
  openai: "/logos/openai.svg",
  // Padded to a square so the tall ring-and-bar mark survives a circular crop.
  oura: "/logos/oura-mark.png",
  polymarket: "/logos/polymarket.svg",
  spacex: "/logos/spacex.png",
};

export function localLogo(slug: string): string | null {
  return LOCAL_LOGOS[slug] ?? null;
}

/** Volume-weighted perpetual consensus across the venues that actually traded. */
/**
 * A venue's price in the same unit as every other venue's.
 *
 * The API works out that a listing is denominated in tenths of a share and
 * sends the comparable figure alongside the venue's own quote. Falling back to
 * the raw price keeps this correct against an API that has not shipped that
 * field yet -- the tolerance filter below still catches the mismatch, so the
 * two can deploy in either order.
 */
function normalized(row: JsonPerp): number | null {
  return row.normalizedPrice ?? row.price;
}

/**
 * Price at which half the traded volume sits below, weighted by volume.
 *
 * Used as the midpoint to measure venues against rather than a plain mean,
 * because the mean is what a bad quote distorts in the first place.
 */
function weightedMedianPrice(rows: JsonPerp[]): number | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => normalized(a)! - normalized(b)!);
  const half = sorted.reduce((sum, row) => sum + row.volume!, 0) / 2;
  let running = 0;
  for (const row of sorted) {
    running += row.volume!;
    if (running >= half) return normalized(row)!;
  }
  return normalized(sorted[sorted.length - 1])!;
}

/**
 * How far a venue may quote from the midpoint before it stops being a quote
 * about the same thing. Real dispersion between perpetual venues sits inside a
 * few percent; a venue listing a different contract size is out by an order of
 * magnitude, so anything this far out is a unit mismatch, not a price.
 */
const PRICE_TOLERANCE = 0.25;

export function reference(entry: CompanyMarketData | undefined) {
  const traded = (entry?.perpetuals ?? []).filter((row) =>
    row.price !== null && Number.isFinite(row.price) && row.price > 0 &&
    row.volume !== null && Number.isFinite(row.volume) && row.volume > 0,
  );
  // Once the API rescales a mismatched listing there is nothing here to drop,
  // and the venue keeps its share of the weight. The filter stays as a floor:
  // it covers an API that predates the rescaling, and a venue off by some
  // factor the API declined to correct is still not a price we should average.
  const midpoint = weightedMedianPrice(traded);
  const quoted = midpoint === null ? traded : traded.filter((row) => Math.abs(normalized(row)! - midpoint) <= midpoint * PRICE_TOLERANCE);
  const quotedVolume = quoted.reduce((sum, row) => sum + row.volume!, 0);
  // Valuations stay on every venue, including one the price filter dropped. A
  // venue divides by its own contract size to get there, so a venue quoting a
  // different size still reports a valuation in line with the rest -- the one
  // excluded above for a 10x price gap is within 3% on valuation.
  const valued = traded.filter((row) => row.estimatedValuation !== null && Number.isFinite(row.estimatedValuation) && row.estimatedValuation > 0);
  const valuedVolume = valued.reduce((sum, row) => sum + row.volume!, 0);
  return {
    price: quotedVolume > 0 ? quoted.reduce((sum, row) => sum + normalized(row)! * row.volume!, 0) / quotedVolume : null,
    valuation: valuedVolume > 0 ? valued.reduce((sum, row) => sum + row.estimatedValuation! * row.volume!, 0) / valuedVolume : null,
    volume: quotedVolume > 0 ? quotedVolume : null,
    venues: quoted.length,
    excluded: traded.length - quoted.length,
  };
}


/**
 * Contracts behind a company's quoted price.
 *
 * A perpetual on a private company is written against a notional billion
 * contracts, and the price is one of them. Read each venue's own
 * `estimatedValuation` back against its own price and that is exactly what
 * comes out: Bitunix, BingX and Aster all return 1,000,000,000 to the digit,
 * and the rest sit within a few percent of it.
 *
 * So the quoted price is already the company divided by a billion, and
 * multiplying it by a real share count counts the division twice. Doing that
 * with Anthropic's 1.389bn put $2.85T on screen where the venues say $2.06T,
 * the 1.383x the two share counts differ by.
 *
 * The figure the site shows is therefore the venues' own, volume-weighted.
 * This returns the divisor implied by that figure, for drawing a history: a
 * recorded price times this basis lands on today's published valuation by
 * construction, so the end of the chart and the top of the page agree.
 */
export function valuationBasis(price: number | null, valuation: number | null): number | null {
  return price !== null && price > 0 && valuation !== null && valuation > 0 ? valuation / price : null;
}

export function attachReferences(companies: Company[], bySlug: Map<string, CompanyMarketData>): Company[] {
  return companies.map((company) => {
    const figures = reference(bySlug.get(company.slug));
    return { ...company, price: figures.price, valuation: figures.valuation,
      referenceVenues: figures.venues, referenceVolume: figures.volume, referenceExcluded: figures.excluded };
  });
}
