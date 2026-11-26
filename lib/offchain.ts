import { cached } from "@/lib/cache";

/**
 * Off-chain prices: the per-share price and company valuation from private
 * market transactions, plus the share count and logo from the company list.
 *
 * Shown on the site only as "off-chain". The host is configurable so it can
 * move without a deploy.
 */

const DEFAULT_BASE = "https://api.allocationsx.com/v1/public";
/** These figures move with private-market transactions, not by the minute. */
const TTL_SECONDS = 10 * 60;

/** Our slug to the feed's, where they differ. */
const FEED_SLUGS: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai-information-technology",
  anduril: "anduril",
  neuralink: "neuralink",
};

/**
 * Companies whose off-chain valuation is the current off-chain share price ×
 * total shares, not the feed's `market_cap`. For these the feed's `market_cap`
 * is the last priced round, which goes stale as the off-chain price moves
 * (Anthropic's has stayed at its May 2026 round while the price has moved on).
 */
const VALUATION_FROM_PRICE = new Set(["anthropic"]);

/** How `marketCap` was worked out. */
export type ValuationBasis = "price × shares" | "last round";

export interface OffchainCompany {
  slug: string;
  name: string;
  sector: string | null;
  logo: string | null;
  /** Off-chain price for one share. */
  price: number | null;
  /** Off-chain valuation of the whole company. */
  marketCap: number | null;
  /** Where `marketCap` comes from; null when there is no valuation. */
  valuationBasis: ValuationBasis | null;
  /** The feed's `market_cap`, the last priced round, kept even when `marketCap` is price × shares. */
  lastRoundValuation: number | null;
  totalShares: number | null;
}

export interface OffchainData {
  asOf: string | null;
  companies: Map<string, OffchainCompany>;
}

type Row = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const nameKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

async function getItems(path: string): Promise<{ asOf: string | null; items: Row[] }> {
  const base = (process.env.OFFCHAIN_API_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) { throw new Error(`Off-chain feed returned ${response.status}`); }
  const body = (await response.json()) as Row;
  const data = (body?.data ?? {}) as Row;
  const items = Array.isArray(data.items) ? data.items.filter((item): item is Row => item !== null && typeof item === "object") : [];
  return { asOf: str(data.as_of), items };
}

/** Finds a feed row by our slug's mapping, else by a name that starts with ours. */
function pick(items: Row[], slug: string, name: string): Row | undefined {
  const feedSlug = FEED_SLUGS[slug] ?? slug;
  return items.find((item) => item.slug === feedSlug)
    ?? items.find((item) => { const other = str(item.name); return other !== null && nameKey(other).startsWith(nameKey(name)); });
}

/**
 * Off-chain figures for the given companies. The price feed is required; the
 * company list only adds share counts and logos, so losing it costs those
 * fields and nothing else.
 */
export function offchainData(companies: readonly { slug: string; name: string }[]): Promise<OffchainData> {
  const key = `offchain:v2:${companies.map((company) => company.slug).join(",")}`;
  return cached(key, TTL_SECONDS, async () => {
    const [prices, list] = await Promise.all([
      getItems("/reference-prices"),
      getItems("/valuation/companies").catch(() => ({ asOf: null, items: [] as Row[] })),
    ]);
    const entries = companies.map(({ slug, name }) => {
      const priced = pick(prices.items, slug, name);
      const listed = pick(list.items, slug, name);
      const price = num(priced?.share_price);
      const totalShares = num(listed?.total_shares);
      const lastRoundValuation = num(priced?.market_cap);
      const fromPrice = VALUATION_FROM_PRICE.has(slug) && price !== null && totalShares !== null;
      const marketCap = fromPrice ? price * totalShares : lastRoundValuation;
      return [slug, {
        slug,
        name,
        sector: str(priced?.sector),
        logo: str(priced?.logo_url) ?? str(listed?.logo_url),
        price,
        marketCap,
        valuationBasis: marketCap === null ? null : fromPrice ? "price × shares" : "last round",
        lastRoundValuation,
        totalShares,
      } satisfies OffchainCompany] as const;
    });
    // Serialised as a plain object so the cache can store it.
    return { asOf: prices.asOf, companies: Object.fromEntries(entries) };
  }).then((value) => ({ asOf: value.asOf, companies: new Map(Object.entries(value.companies)) }));
}

/** One company from AllocationsX's list, for the valuation calculator. */
export interface ValuationCompany {
  slug: string;
  name: string;
  logo: string | null;
  totalShares: number;
  /** AllocationsX's off-chain price for one share, where it publishes one. */
  sharePrice: number | null;
  /** AllocationsX's valuation for the company, where it publishes one. */
  valuation: number | null;
}

/** The calculator's copy promises an hourly refresh; hold the list that long. */
const CALCULATOR_TTL_SECONDS = 60 * 60;

/**
 * The companies this site covers, as AllocationsX lists them: share count,
 * logo, and its off-chain price and valuation where it has them. A company
 * without a share count cannot turn a price into a valuation, so it is left out.
 */
export function valuationCompanies(companies: readonly { slug: string; name: string }[]): Promise<{ asOf: string | null; companies: ValuationCompany[] }> {
  return cached(`offchain:calculator:v2:${companies.map((company) => company.slug).join(",")}`, CALCULATOR_TTL_SECONDS, async () => {
    const [list, prices] = await Promise.all([
      getItems("/valuation/companies"),
      getItems("/reference-prices").catch(() => ({ asOf: null, items: [] as Row[] })),
    ]);
    const found = companies.flatMap(({ slug, name }): ValuationCompany[] => {
      const listed = pick(list.items, slug, name);
      const priced = pick(prices.items, slug, name);
      const totalShares = num(listed?.total_shares);
      if (totalShares === null) { return []; }
      return [{
        slug, name, totalShares,
        logo: str(listed?.logo_url) ?? str(priced?.logo_url),
        sharePrice: num(priced?.share_price),
        valuation: num(priced?.market_cap),
      }];
    });
    return { asOf: prices.asOf ?? list.asOf, companies: found };
  });
}
