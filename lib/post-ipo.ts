import { atlasFeed, ATLAS_SYMBOLS } from "@/lib/atlas";
import { cached } from "@/lib/cache";
import { LISTED } from "@/lib/coverage-view";
import { COVERAGE_COMPANIES } from "@/lib/market-coverage/shared";
import { issuerTokens, OPENSTOCKS_TOKENS, openstocksOnchain, openstocksUnitPrices } from "@/lib/issuers";

/**
 * Pre-IPO → IPO: what happens to an issuer's token once its company lists.
 *
 * The shares behind a pre-IPO token stay under the company's lock-up after the
 * listing, so the token cannot yet be converted into public stock and trades
 * at a discount to it. Two figures describe that discount:
 *
 * - current discount: how far below the public value the token trades now;
 * - mark discount: the discount the issuer applies when it provides conversion
 *   liquidity, which steps down as each tranche of shares unlocks.
 *
 * PreStocks publishes both, with its unlock schedule, at /api/postipo/{slug}.
 * OpenStocks publishes no schedule; its current discount is worked out from its
 * own figures: the pre-IPO token's pool price (oANTHROPIC) against OpenStocks'
 * unit price, the public value of one pre-IPO token.
 */

export type Step = { date: string; discount: number };

export type IssuerIpo = {
  issuer: "PreStocks" | "OpenStocks";
  url: string;
  /** The pre-IPO token and what it trades at. */
  token: { symbol: string; price: number; holders: number | null; volume24h: number | null; tokenMarketCap: number | null };
  /** The public value the token is measured against, and what that is. */
  reference: { price: number; label: string };
  /** Fraction, 0.25 = 25% below the public value. */
  currentDiscount: number;
  /** The issuer's own mark discount today, where it publishes one. */
  markDiscount: number | null;
  /** The issuer's unlock schedule: mark discount by date, where it publishes one. */
  schedule: Step[] | null;
  /** The public token the pre-IPO token converts into, where the issuer has one, with its own discount. */
  publicToken: { symbol: string; price: number; holders: number | null; volume24h: number | null; reference: number | null; discount: number | null } | null;
  /** How many public shares one pre-IPO token stands for, where it can be worked out. */
  sharesPerToken: number | null;
};

export type IpoCompany = {
  slug: string;
  name: string;
  exchange: string;
  ticker: string;
  since: string;
  source: string;
  /** The public share price the issuers measure against. */
  sharePrice: number | null;
  issuers: IssuerIpo[];
  /** The Atlas oracle's feed for the company's public-share token (ANTB, SPCXB), where it has one. */
  atlas: IpoAtlas | null;
};

export type IpoAtlas = {
  symbol: string;
  feedName: string;
  url: string;
  /** Aggregate price for one token (one share), USD. */
  price: number;
  updatedAt: string;
  /** Against `sharePrice`: positive is a premium, negative a discount. Null without a share price. */
  premium: number | null;
  method: string[];
  consensusScore: number | null;
  consensusStatus: string | null;
  sources: { exchange: string; market: string; price: number | null; volume24h: number | null; weighting: number | null; status: string }[];
};

const TTL_SECONDS = 10 * 60;

/**
 * The public value each OpenStocks token is measured against, set by the owner:
 * one oANTHROPIC stands for 10 ANT shares at $83 ($830), and one oANTHROPICx for
 * one share ($83). These are fixed figures, not live prices; update them here.
 * A company without an entry falls back to OpenStocks' own unit price.
 */
const OPENSTOCKS_REFERENCE: Record<string, { pre: number; public: number; note: string }> = {
  anthropic: { pre: 830, public: 83, note: "10 ANT shares at $83" },
};
const TIMEOUT_MS = 15_000;

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const positive = (value: unknown) => { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; };

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "markets-ipo/1.0" }, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) { throw new Error(`${new URL(url).host} returned ${response.status}`); }
  return response.json();
}

/** The mark discount in force today: the last step on or before today. */
function markToday(schedule: Step[], today: string): number | null {
  const past = schedule.filter((step) => step.date <= today);
  return past.length ? past[past.length - 1].discount : schedule[0]?.discount ?? null;
}

async function prestocksIpo(slug: string, holders: number | null): Promise<{ issuer: IssuerIpo; sharePrice: number } | null> {
  const body = asRow(await cached(`prestocks-postipo:v1:${slug}`, TTL_SECONDS, () => getJson(`https://prestocks.com/api/postipo/${encodeURIComponent(slug)}`)));
  const current = asRow(body.current);
  const sharePrice = positive(current.sharePrice);
  const tokenPrice = positive(current.tokenPrice);
  const implied = typeof current.impliedDiscount === "number" ? current.impliedDiscount / 100 : null;
  if (sharePrice === null || tokenPrice === null || implied === null) { return null; }
  const schedule = (Array.isArray(body.steps) ? body.steps : []).flatMap((step): Step[] => {
    const row = asRow(step);
    return typeof row.date === "string" && typeof row.target === "number" ? [{ date: row.date, discount: row.target / 100 }] : [];
  });
  return {
    sharePrice,
    issuer: {
      issuer: "PreStocks", url: `https://prestocks.com/${slug}`,
      token: { symbol: slug.toUpperCase(), price: tokenPrice, holders, volume24h: null, tokenMarketCap: null },
      reference: { price: sharePrice, label: "public share price, as PreStocks quotes it" },
      currentDiscount: implied,
      markDiscount: schedule.length ? markToday(schedule, new Date().toISOString().slice(0, 10)) : null,
      schedule: schedule.length ? schedule : null,
      publicToken: null,
      sharesPerToken: 1,
    },
  };
}

async function openstocksIpo(slug: string, sharePrice: number | null): Promise<IssuerIpo | null> {
  const tokens = OPENSTOCKS_TOKENS[slug] ?? [];
  const pre = tokens.find((token) => token.kind === "pre-IPO");
  const pub = tokens.find((token) => token.kind === "public");
  if (!pre) { return null; }
  const [onchain, units] = await Promise.all([openstocksOnchain(), openstocksUnitPrices()]);
  const preChain = onchain[pre.symbol];
  const fixed = OPENSTOCKS_REFERENCE[slug] ?? null;
  const unit = fixed?.pre ?? units[slug] ?? null;
  if (!preChain?.price || !unit) { return null; }
  const pubChain = pub ? onchain[pub.symbol] : undefined;
  const pubReference = fixed?.public ?? sharePrice;
  return {
    issuer: "OpenStocks", url: "https://app.openstocks.xyz/trade",
    token: { symbol: pre.symbol, price: preChain.price, holders: preChain.holders, volume24h: preChain.volume24h, tokenMarketCap: preChain.tokenMarketCap },
    reference: { price: unit, label: fixed ? `public value of one ${pre.symbol}: ${fixed.note}` : "OpenStocks unit price, the public value of one token" },
    currentDiscount: 1 - preChain.price / unit,
    markDiscount: null,
    schedule: null,
    publicToken: pub && pubChain?.price ? {
      symbol: pub.symbol, price: pubChain.price, holders: pubChain.holders, volume24h: pubChain.volume24h,
      reference: pubReference, discount: pubReference ? 1 - pubChain.price / pubReference : null,
    } : null,
    sharesPerToken: fixed ? fixed.pre / fixed.public : sharePrice ? unit / sharePrice : null,
  };
}

/**
 * Every covered company that has listed, with each issuer's post-IPO discount.
 * An issuer that does not answer is left out of this read only: the feeds are
 * cached underneath, so a failed read is retried on the next request rather
 * than held for ten minutes.
 */
export async function postIpo(): Promise<IpoCompany[]> {
  {
    const tokens = await issuerTokens().catch(() => ({} as Awaited<ReturnType<typeof issuerTokens>>));
    return Promise.all(Object.entries(LISTED).map(async ([slug, listing]) => {
      const name = COVERAGE_COMPANIES.find((company) => company.slug === slug)?.name ?? listing.name ?? slug;
      const preHolders = tokens[slug]?.find((token) => token.issuer === "PreStocks")?.holders ?? null;
      const prestocks = await prestocksIpo(slug, preHolders).catch(() => null);
      const sharePrice = prestocks?.sharePrice ?? null;
      const [openstocks, feed] = await Promise.all([
        openstocksIpo(slug, sharePrice).catch(() => null),
        ATLAS_SYMBOLS[slug] ? atlasFeed(ATLAS_SYMBOLS[slug]) : Promise.resolve(null),
      ]);
      const atlas: IpoAtlas | null = feed ? {
        symbol: feed.symbol, feedName: feed.feedName, url: feed.url, price: feed.price, updatedAt: feed.updatedAt,
        premium: sharePrice ? feed.price / sharePrice - 1 : null,
        method: feed.method, consensusScore: feed.consensusScore, consensusStatus: feed.consensusStatus,
        sources: feed.sources.map(({ exchange, market, price, volume24h, weighting, status }) => ({ exchange, market, price, volume24h, weighting, status })),
      } : null;
      // `name` last: a covered company's own name wins over LISTED's fallback.
      return { slug, ...listing, name, sharePrice, issuers: [prestocks?.issuer, openstocks].filter((item): item is IssuerIpo => !!item), atlas };
    }));
  }
}
