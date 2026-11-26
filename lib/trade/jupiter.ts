import { SOLANA_USDC } from "@/lib/trade/tokens";

/**
 * Quotes for PreStocks' Solana tokens from Jupiter's free quote API
 * (lite-api.jup.ag, no key). PreStocks mints are Token-2022 with a scaled UI
 * amount: the raw amount Jupiter quotes is multiplied by the mint's current
 * multiplier to give the number of tokens a wallet shows, so the mint is read
 * from a public Solana RPC first. They also carry an issuer-set transfer fee,
 * which is surfaced next to the quote.
 */

const JUPITER_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
/** Public Solana RPCs that answer browsers. api.mainnet-beta refuses browser origins, so it is the fallback. */
const SOLANA_RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

export type MintInfo = { decimals: number; multiplier: number; transferFeeBps: number };

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});

async function solanaRpc(method: string, params: unknown[]): Promise<unknown> {
  let lastError: unknown = null;
  for (const url of SOLANA_RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) { throw new Error(`Solana RPC returned ${response.status}`); }
      const body = obj(await response.json());
      if (body.error) { throw new Error(String(obj(body.error).message ?? "Solana RPC error")); }
      return body.result;
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Solana RPC unavailable");
}

const mintCache = new Map<string, Promise<MintInfo>>();

/** Decimals, current UI multiplier and transfer fee of a Token-2022 mint. */
export function mintInfo(mint: string): Promise<MintInfo> {
  let found = mintCache.get(mint);
  if (!found) {
    found = Promise.all([
      solanaRpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]),
      solanaRpc("getEpochInfo", []).catch(() => null),
    ]).then(([account, epochInfo]) => {
      const info = obj(obj(obj(obj(obj(account).value).data).parsed).info);
      const decimals = Number(info.decimals);
      if (!Number.isFinite(decimals)) { throw new Error("Mint not found"); }
      const extensions = Array.isArray(info.extensions) ? info.extensions.map(obj) : [];
      const state = (name: string) => obj(extensions.find((ext) => ext.extension === name)?.state);
      const scaled = state("scaledUiAmountConfig");
      const nowSeconds = Date.now() / 1000;
      const switchAt = Number(scaled.newMultiplierEffectiveTimestamp ?? Infinity);
      const multiplier = Number((nowSeconds >= switchAt ? scaled.newMultiplier : scaled.multiplier) ?? 1) || 1;
      const fees = state("transferFeeConfig");
      const epoch = Number(obj(epochInfo).epoch ?? Infinity);
      const newer = obj(fees.newerTransferFee);
      const fee = epoch >= Number(newer.epoch ?? 0) ? newer : obj(fees.olderTransferFee);
      return { decimals, multiplier, transferFeeBps: Number(fee.transferFeeBasisPoints ?? 0) || 0 };
    });
    found.catch(() => mintCache.delete(mint));
    mintCache.set(mint, found);
  }
  return found;
}

export type JupiterQuote = {
  side: "buy" | "sell";
  /** UI amounts: what a wallet would show. */
  amountIn: number;
  amountOut: number;
  minOut: number;
  /** Fraction, as Jupiter reports it against its reference price. */
  priceImpact: number;
  routeLabel: string;
  transferFeeBps: number;
  quotedAt: number;
};

export class JupiterError extends Error {
  constructor(public code: "no-route" | "network", message: string) { super(message); }
}

/** Jupiter's best route for an exact input: buy spends USDC on the token, sell the reverse. */
export async function quoteJupiter(args: { mint: string; symbol: string; side: "buy" | "sell"; amountIn: number; slippageBps: number }): Promise<JupiterQuote> {
  const { mint, symbol, side, amountIn, slippageBps } = args;
  const token = await mintInfo(mint).catch(() => { throw new JupiterError("network", "Could not read the token's mint on Solana."); });
  const tokenScale = 10 ** token.decimals / token.multiplier;
  const usdcScale = 10 ** SOLANA_USDC.decimals;
  const rawIn = Math.floor(amountIn * (side === "buy" ? usdcScale : tokenScale));
  if (rawIn <= 0) { throw new JupiterError("no-route", "Enter a larger amount."); }
  const params = new URLSearchParams({
    inputMint: side === "buy" ? SOLANA_USDC.mint : mint,
    outputMint: side === "buy" ? mint : SOLANA_USDC.mint,
    amount: String(rawIn),
    slippageBps: String(Math.round(slippageBps)),
    swapMode: "ExactIn",
  });
  let response: Response;
  try {
    response = await fetch(`${JUPITER_QUOTE}?${params}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new JupiterError("network", "Jupiter did not answer. Check your connection and try again.");
  }
  const body = obj(await response.json().catch(() => ({})));
  if (!response.ok || !body.outAmount) {
    const message = String(body.error ?? body.errorCode ?? "");
    if (/route|liquidity|COULD_NOT_FIND/i.test(message) || response.status === 400) {
      throw new JupiterError("no-route", `Jupiter found no route for ${symbol} at this amount.`);
    }
    throw new JupiterError("network", `Jupiter returned ${response.status}.`);
  }
  const outScale = side === "buy" ? tokenScale : usdcScale;
  const routes = Array.isArray(body.routePlan) ? body.routePlan.map((step) => String(obj(obj(step).swapInfo).label ?? "")).filter(Boolean) : [];
  return {
    side,
    amountIn,
    amountOut: Number(body.outAmount) / outScale,
    minOut: Number(body.otherAmountThreshold ?? body.outAmount) / outScale,
    priceImpact: Math.max(0, Number(body.priceImpactPct ?? 0) || 0),
    routeLabel: `${side === "buy" ? `USDC → ${symbol}` : `${symbol} → USDC`} · Jupiter${routes.length ? ` via ${[...new Set(routes)].join(", ")}` : ""}`,
    transferFeeBps: token.transferFeeBps,
    quotedAt: Date.now(),
  };
}
