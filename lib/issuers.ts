import { cached } from "@/lib/cache";
import { OPENSTOCKS_TOKENS, PAIMON_APP, PAIMON_TOKENS, type OpenstocksToken } from "@/lib/trade/tokens";

/**
 * Other issuers' tokenized pre-IPO products, read from each issuer's own
 * public feed so the figure shown is the figure they publish.
 *
 * PreStocks follows the market data API's issuer adapter: /api/metrics carries
 * the token price, market cap and holders, and only /api/prestocks carries the
 * mark and implied valuation, so the second is optional. xStocks publishes a
 * quote per asset; it lists no valuation, so none is shown for it.
 *
 * OpenStocks (app.openstocks.xyz) publishes one unit price per company at
 * /api/v1/prices/unit-prices: `unitPriceUsd` is its own price for a unit
 * (set by OpenStocks, or the pool price when `source` is "onchain") and
 * `onchainPriceUsd` is what the on-chain pool trades at. Companies with
 * neither are listed but not yet tradable, and are left out.
 */

export interface IssuerToken {
  issuer: "PreStocks" | "xStocks" | "OpenStocks" | "Paimon";
  /** The issuer's own symbol: ANTHROPIC, ANTx. */
  symbol: string;
  name: string;
  chain: string;
  price: number;
  /** The issuer's own mark for one share, where it publishes one. */
  markPrice: number | null;
  /** Company valuation implied by the token price, as the issuer publishes it. */
  impliedValuation: number | null;
  /** Company valuation at the issuer's mark. */
  markValuation: number | null;
  /** Value of the tokens in circulation. */
  tokenMarketCap: number | null;
  holders: number | null;
  /** Percent, as the issuer reports it. */
  change30d: number | null;
  volumeAllTime: number | null;
  /** Traded in the last 24 hours, where the issuer's token has an on-chain pool. */
  volume24h?: number | null;
  url: string | null;
}

const TTL_SECONDS = 10 * 60;
const TIMEOUT_MS = 15_000;

/** Each issuer's symbol for our companies. A company an issuer does not list is absent. */
const PRESTOCKS_SYMBOLS: Record<string, string> = {
  anthropic: "ANTHROPIC", openai: "OPENAI", anduril: "ANDURIL", neuralink: "NEURALINK", databricks: "DATABRICKS",
  "figure-ai": "FIGUREAI", kalshi: "KALSHI", polymarket: "POLYMARKET", oura: "OURA",
  // Not a covered company: read for SpaceX's derived price and Pre-IPO → IPO panel only.
  spacex: "SPACEX",
};
/** OpenStocks names its companies by display name; ours, keyed the same way. */
const OPENSTOCKS_NAMES: Record<string, string> = {
  anthropic: "Anthropic", openai: "OpenAI", anduril: "Anduril", neuralink: "Neuralink", databricks: "Databricks",
  "figure-ai": "Figure AI", kalshi: "Kalshi", polymarket: "Polymarket", oura: "Oura",
  spacex: "SpaceX",
};
const OPENSTOCKS_PRICES = "https://app.openstocks.xyz/api/v1/prices/unit-prices";
// The token table lives in a client-safe module so the trade flow can read it too.
export { OPENSTOCKS_TOKENS, type OpenstocksToken };
const GECKO = "https://api.geckoterminal.com/api/v2/networks/bsc/tokens";

export type OnchainToken = { price: number | null; tokenMarketCap: number | null; volume24h: number | null; holders: number | null };

/** On-chain figures for OpenStocks' tokens, keyed by symbol. A token GeckoTerminal does not answer for is absent. */
export function openstocksOnchain(): Promise<Record<string, OnchainToken>> {
  return cached("openstocks-onchain:v3", TTL_SECONDS, async () => {
    const tokens = Object.values(OPENSTOCKS_TOKENS).flat();
    const multi = asRow(await getJson(`${GECKO}/multi/${tokens.map((token) => token.address).join(",")}`));
    const byAddress = new Map(asList(multi.data).map((row) => [String(asRow(row.attributes).address ?? "").toLowerCase(), asRow(row.attributes)]));
    // Holder counts are on the per-token info route only. GeckoTerminal's public tier rate-limits bursts,
    // so these go one at a time with one retry; the result is cached for ten minutes.
    const readHolders = (address: string) => getJson(`${GECKO}/${address}/info`)
      .then((body) => positive(asRow(asRow(asRow(asRow(body).data).attributes).holders).count));
    const holders: (number | null)[] = [];
    for (const token of tokens) {
      holders.push(await readHolders(token.address)
        .catch(() => new Promise((resolve) => setTimeout(resolve, 1500)).then(() => readHolders(token.address)))
        .catch(() => null));
    }
    return Object.fromEntries(tokens.flatMap((token, index) => {
      const row = byAddress.get(token.address.toLowerCase());
      if (!row) { return []; }
      return [[token.symbol, {
        price: positive(row.price_usd),
        tokenMarketCap: positive(row.market_cap_usd) ?? positive(row.fdv_usd),
        volume24h: num(asRow(row.volume_usd).h24),
        holders: holders[index],
      } satisfies OnchainToken]];
    }));
  });
}
const OPENSTOCKS_TRADE = "https://app.openstocks.xyz/trade";
const PRESTOCKS_METRICS = "https://prestocks.com/api/metrics";
const PRESTOCKS_PRODUCTS = "https://prestocks.com/api/prestocks";
const XSTOCKS_SYMBOLS: Record<string, string> = { anthropic: "ANTx" };

type Row = Record<string, unknown>;
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const asList = (value: unknown): Row[] => (Array.isArray(value) ? value.map(asRow) : []);
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") { return null; }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: unknown) => { const parsed = num(value); return parsed !== null && parsed > 0 ? parsed : null; };
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "markets-issuers/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) { throw new Error(`${new URL(url).host} returned ${response.status}`); }
  return response.json();
}

async function prestocks(): Promise<Record<string, IssuerToken>> {
  const [metrics, products] = await Promise.all([
    getJson(PRESTOCKS_METRICS),
    getJson(PRESTOCKS_PRODUCTS).catch(() => null),
  ]);
  const metricRows = asList(asRow(metrics).metrics);
  const productRows = asList(products);
  const out: Record<string, IssuerToken> = {};
  for (const [slug, symbol] of Object.entries(PRESTOCKS_SYMBOLS)) {
    const metric = metricRows.find((row) => row.symbol === symbol);
    const price = positive(metric?.tokenPrice);
    if (!metric || price === null) { continue; }
    const product = productRows.find((row) => row.symbol === symbol);
    out[slug] = {
      issuer: "PreStocks",
      symbol,
      name: str(product?.name) ?? `${symbol} PreStocks`,
      chain: "Solana",
      price,
      markPrice: positive(product?.markPrice),
      impliedValuation: positive(product?.impliedValuation),
      markValuation: positive(product?.markValuation),
      tokenMarketCap: positive(metric.marketCapUSD),
      holders: positive(metric.holderCount),
      change30d: num(metric.thirtyDayChange),
      volumeAllTime: positive(metric.cumulativeVolumeUSD),
      url: str(product?.external_url),
    };
  }
  return out;
}

async function xstocks(): Promise<Record<string, IssuerToken>> {
  const base = "https://api.backed.fi/api/v2/public/assets";
  const entries = await Promise.all(Object.entries(XSTOCKS_SYMBOLS).map(async ([slug, symbol]) => {
    const [asset, quote] = await Promise.all([
      getJson(`${base}/${encodeURIComponent(symbol)}`).then(asRow).catch(() => ({} as Row)),
      getJson(`${base}/${encodeURIComponent(symbol)}/price-data`).then(asRow),
    ]);
    const price = positive(quote.quote);
    if (price === null || asset.isTradingHalted === true) { return null; }
    const token: IssuerToken = {
      issuer: "xStocks",
      symbol,
      name: str(asset.name) ?? `${symbol} xStock`,
      chain: "Multichain",
      price,
      markPrice: null,
      impliedValuation: null,
      markValuation: null,
      tokenMarketCap: null,
      holders: null,
      change30d: null,
      volumeAllTime: null,
      url: `https://defi.xstocks.fi/${encodeURIComponent(symbol)}`,
    };
    return [slug, token] as const;
  }));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, IssuerToken] => entry !== null));
}

type OpenstocksPrice = { company: string; ticker: string | null; logo: string | null; unitPrice: number | null; source: string | null; onchainPrice: number | null; effectiveAt: string | null };

async function openstocksPrices(): Promise<OpenstocksPrice[]> {
  const body = asRow(await getJson(OPENSTOCKS_PRICES));
  return asList(body.data).flatMap((row) => {
    const company = str(row.companyName);
    const unitPrice = positive(row.unitPriceUsd);
    const onchainPrice = positive(row.onchainPriceUsd);
    return company && (unitPrice !== null || onchainPrice !== null)
      ? [{ company, ticker: str(row.ticker), logo: str(row.logoUrl), unitPrice, source: str(row.source), onchainPrice, effectiveAt: str(row.effectiveAt) }]
      : [];
  });
}

/** OpenStocks' own unit price per company: the public value of one pre-IPO token. */
export async function openstocksUnitPrices(): Promise<Record<string, number>> {
  const prices = await openstocksPrices();
  return Object.fromEntries(Object.entries(OPENSTOCKS_NAMES).flatMap(([slug, name]) => {
    const row = prices.find((item) => item.company.toLowerCase() === name.toLowerCase());
    return row?.unitPrice ? [[slug, row.unitPrice]] : [];
  }));
}

async function openstocks(): Promise<Record<string, IssuerToken[]>> {
  const [prices, onchain] = await Promise.all([openstocksPrices(), openstocksOnchain().catch(() => ({} as Record<string, OnchainToken>))]);
  const out: Record<string, IssuerToken[]> = {};
  for (const [slug, name] of Object.entries(OPENSTOCKS_NAMES)) {
    const row = prices.find((item) => item.company.toLowerCase() === name.toLowerCase());
    // Companies with a token config are read on-chain; the others fall back to OpenStocks' price feed.
    const tokens: OpenstocksToken[] = OPENSTOCKS_TOKENS[slug] ?? (row ? [{ symbol: row.ticker ?? name.toUpperCase(), address: "", kind: "pre-IPO" }] : []);
    for (const token of tokens) {
      const chain = onchain[token.symbol];
      const price = chain?.price ?? (token.kind === "pre-IPO" ? row?.onchainPrice ?? row?.unitPrice ?? null : null);
      if (price === null) { continue; }
      (out[slug] ??= []).push({
        issuer: "OpenStocks",
        symbol: token.symbol,
        name: `${name} ${token.kind} token`,
        chain: "BNB Chain",
        price,
        // OpenStocks' unit price is the public value of one pre-IPO token.
        markPrice: token.kind === "pre-IPO" && row?.unitPrice && row.unitPrice !== price ? row.unitPrice : null,
        impliedValuation: null,
        markValuation: null,
        tokenMarketCap: chain?.tokenMarketCap ?? null,
        holders: chain?.holders ?? null,
        change30d: null,
        volumeAllTime: null,
        volume24h: chain?.volume24h ?? null,
        url: OPENSTOCKS_TRADE,
      });
    }
  }
  return out;
}

/**
 * Paimon Finance's SPV tokens, read on-chain like OpenStocks'. Paimon states
 * no shares per token; one token reads as the valuation in billions (CMC lists
 * a 1B max supply), so the implied valuation is price × 1e9.
 */
async function paimon(): Promise<Record<string, IssuerToken[]>> {
  const tokens = Object.entries(PAIMON_TOKENS).flatMap(([slug, list]) => list.map((token) => ({ slug, token })));
  const multi = asRow(await getJson(`${GECKO}/multi/${tokens.map(({ token }) => token.address).join(",")}`));
  const byAddress = new Map(asList(multi.data).map((row) => [String(asRow(row.attributes).address ?? "").toLowerCase(), asRow(row.attributes)]));
  const out: Record<string, IssuerToken[]> = {};
  for (const { slug, token } of tokens) {
    const row = byAddress.get(token.address.toLowerCase());
    const price = row ? positive(row.price_usd) : null;
    if (!row || price === null) { continue; }
    const holders = await getJson(`${GECKO}/${token.address}/info`)
      .then((body) => positive(asRow(asRow(asRow(asRow(body).data).attributes).holders).count))
      .catch(() => null);
    (out[slug] ??= []).push({
      issuer: "Paimon",
      symbol: token.symbol,
      name: `${OPENSTOCKS_NAMES[slug] ?? slug} SPV token`,
      chain: "BNB Chain",
      price,
      markPrice: null,
      impliedValuation: price * 1e9,
      markValuation: null,
      tokenMarketCap: positive(row.market_cap_usd),
      holders,
      change30d: null,
      volumeAllTime: null,
      volume24h: num(asRow(row.volume_usd).h24),
      url: PAIMON_APP,
    });
  }
  return out;
}

/** Every issuer token we can read, grouped by our company slug. A failing issuer costs only its own rows. */
export function issuerTokens(): Promise<Record<string, IssuerToken[]>> {
  return cached("issuer-tokens:v8", TTL_SECONDS, async () => {
    const results = await Promise.allSettled([openstocks(), prestocks(), xstocks(), paimon()]);
    const grouped: Record<string, IssuerToken[]> = {};
    for (const result of results) {
      if (result.status !== "fulfilled") { console.warn(`[issuers] ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`); continue; }
      for (const [slug, token] of Object.entries(result.value)) { (grouped[slug] ??= []).push(...(Array.isArray(token) ? token : [token])); }
    }
    if (!Object.keys(grouped).length) { throw new Error("No issuer feed answered"); }
    return grouped;
  });
}
