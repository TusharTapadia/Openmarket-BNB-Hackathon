import { safeUrl, type Company, type CompanyInsights } from "@/app/data";
import { localLogo, type CompanyMarketData } from "@/lib/company-data";
import type { PricePoint } from "@/lib/market-series";
import { cached } from "@/lib/cache";

type Row = Record<string, unknown>;
const DEFAULT_API_URL = "https://openstocks-api.onrender.com";

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function number(value: unknown): number | null {
  if (value == null || value === "" || (typeof value !== "string" && typeof value !== "number")) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
export function record(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
export function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error("Invalid data feed");
  return value.map(record);
}
/**
 * How long each upstream route may be held, in seconds.
 *
 * Taken from how often the data behind it actually moves, not from how fresh
 * it would be nice to look. The venue ingest runs hourly -- a read of all
 * seventeen venues returns two distinct quote timestamps, the newest an hour
 * old -- so a minute on prices is already far fresher than the source. Daily
 * history changes once a day, and a company profile carries share counts,
 * logos and headquarters, which do not change at all on this timescale.
 *
 * Before this, a single page load made fourteen uncached calls for data that
 * updates once an hour.
 */
function ttlFor(path: string): number {
  if (path.startsWith("/companies?")) { return 24 * 60 * 60; }
  if (path.includes("/history")) { return 15 * 60; }
  if (path.includes("/insights")) { return 10 * 60; }
  return 60;
}

/**
 * One request to the upstream feed, cached.
 *
 * Every call in this file goes through here, so caching here covers the whole
 * site rather than the routes someone remembered to annotate. `no-store` stays
 * on the fetch itself: the cache is Redis now, and two caches disagreeing
 * about the same response is the bug this is meant to avoid.
 */
export async function apiGet(path: string): Promise<Row> {
  return cached(`api:${path}`, ttlFor(path), async () => {
    const base = (process.env.PRECAP_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
    const response = await fetch(`${base}/v1${path}`, {
      headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Market feed returned ${response.status}`);
    return record(await response.json());
  });
}

/**
 * Recent reference prices per company, oldest first, keyed by slug.
 *
 * One request per company rather than a bulk route: the API serves history a
 * company at a time and six small calls in parallel cost less than waiting for
 * an endpoint that does not exist yet. A company whose history fails comes back
 * absent rather than failing the page -- the table reads a missing series as
 * "no change to show", which is true.
 */
export async function fetchPriceHistory(slugs: readonly string[], days = 8): Promise<Map<string, number[]>> {
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const body = await apiGet(`/external/precap/companies/${encodeURIComponent(slug)}/history?days=${days}`);
      const points = Array.isArray(body.points) ? body.points.map(record) : [];
      return [slug, points.flatMap((point) => {
        const price = number(point.price);
        return price === null ? [] : [price];
      })] as const;
    }),
  );
  return new Map(results.flatMap((result) => (result.status === "fulfilled" && result.value[1].length ? [result.value] : [])));
}

/**
 * The same history as `fetchPriceHistory`, but whole points.
 *
 * The table only needs the prices, so that one flattens to a list of numbers.
 * The charts need the timestamp a price was recorded at, what traded that
 * hour and how many venues were quoting -- the market series is built by
 * bucketing those by day and summing across companies.
 */
export async function fetchPriceSeries(slugs: readonly string[], days = 90): Promise<Map<string, PricePoint[]>> {
  const results = await Promise.allSettled(
    slugs.map(async (slug) => {
      const body = await apiGet(`/external/precap/companies/${encodeURIComponent(slug)}/history?days=${days}`);
      const points = Array.isArray(body.points) ? body.points.map(record) : [];
      return [slug, points.flatMap((point) => {
        const price = number(point.price);
        const at = text(point.at);
        return price === null || at === null
          ? []
          : [{ at, price, volume: number(point.volume), venues: Math.trunc(number(point.venues) ?? 0) }];
      })] as const;
    }),
  );
  return new Map(results.flatMap((result) => (result.status === "fulfilled" && result.value[1].length ? [result.value] : [])));
}

/**
 * Market data for every company the dashboard covers, keyed by slug.
 *
 * One call rather than one per company: the payload is small, the home page
 * needs all of them to rank by valuation, and a per-company fan-out would turn
 * a cold load into six round trips for no gain.
 */
export async function fetchMarketData(): Promise<Map<string, CompanyMarketData>> {
  const body = await apiGet("/external/precap/companies");
  const list = Array.isArray(body.companies) ? body.companies : [];
  return new Map(
    list.flatMap((entry) => {
      const row = record(entry);
      const slug = text(row.slug);
      return slug ? [[slug, row as unknown as CompanyMarketData] as const] : [];
    }),
  );
}

const nameKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function normalizeCompanies(watchlist: Row[], profiles: Row[]): Company[] {
  const byName = new Map(profiles.flatMap((row) => {
    const name = text(row.name);
    return name ? [[nameKey(name), row] as const] : [];
  }));
  const seen = new Set<string>();
  return watchlist.flatMap((row) => {
    const id = text(row.company_id), name = text(row.name);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    const aliases = Array.isArray(row.aliases) ? row.aliases.filter((item): item is string => typeof item === "string") : [];
    const profile = [name, ...aliases].map((alias) => byName.get(nameKey(alias))).find(Boolean) ?? {};
    const parsedPrice = number(row.market_price);
    const price = parsedPrice !== null && parsedPrice > 0 ? parsedPrice : null;
    const rawShares = number(profile.total_shares);
    const shares = rawShares && rawShares > 0 ? rawShares : null;
    const industry = Array.isArray(profile.industry_tags) ? text(profile.industry_tags[0]) : null;
    const slug = (aliases[0] ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return [{
      id, slug, name,
      price, markPrice: price, referenceVenues: 0, referenceVolume: null, referenceExcluded: 0, history: [], shares, valuation: price !== null && shares !== null ? price * shares : null,
      sector: text(profile.sector) ?? industry,
      // Profile logo first; the bundled one when the profile has none.
      logo: safeUrl(profile.logo_url) ?? localLogo(slug), round: text(profile.latest_round_type), roundDate: text(profile.latest_round_date),
      founded: profile.founded_year == null ? null : String(profile.founded_year),
      headquarters: text(profile.headquarters_location), website: safeUrl(profile.website_url), description: text(profile.description),
    }];
  });
}

export function normalizeInsights(payload: Row): CompanyInsights {
  const data = record(payload.data);
  const funding = rows(data.funding_rounds).flatMap((row) => {
    const id = text(row.id);
    return id ? [{ id, name: text(row.round_name), amount: number(row.amount_raised), valuation: number(row.post_money_valuation),
      date: text(row.announced_at), investor: text(row.lead_investor), status: text(row.status) }] : [];
  }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const articles = (items: unknown) => {
    const seen = new Set<string>();
    return rows(items).flatMap((row) => {
      const title = text(row.title), id = text(row.id);
      const key = title?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!title || !id || !key || seen.has(key)) return [];
      seen.add(key);
      return [{ id, title, source: text(row.publication_name) ?? text(row.source), date: text(row.published_at), url: safeUrl(row.link) }];
    }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  };
  return { funding, news: articles(data.news), research: articles(data.research_reports) };
}
