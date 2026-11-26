import {
  createPublicClient, encodeAbiParameters, encodeFunctionData, encodePacked, fallback, http, maxUint256, parseAbi,
  type Address, type Hex, type PublicClient,
} from "viem";
import { bsc } from "viem/chains";
import { BSC_USDT, OPENSTOCKS_DECIMALS, OPENSTOCKS_POOLS, PANCAKE, type PancakePool } from "@/lib/trade/tokens";

/**
 * PancakeSwap quotes for OpenStocks' BEP-20 tokens, read straight from
 * PancakeSwap's own contracts on BNB Chain: QuoterV2 for v3 pools and the
 * Infinity CLQuoter for Infinity CL pools. Each candidate pool is quoted for
 * the exact amount and the best output wins. The swap goes through
 * PancakeSwap's Infinity Universal Router, which routes v3 and Infinity alike
 * and pulls the input token through Permit2.
 */

/** Public BSC RPCs that answer browsers (CORS *), tried in order. */
export const BSC_RPCS = ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com", "https://56.rpc.thirdweb.com"];

let client: PublicClient | null = null;
export function bscClient(): PublicClient {
  client ??= createPublicClient({
    chain: bsc,
    transport: fallback(BSC_RPCS.map((url) => http(url, { timeout: 10_000, retryCount: 1 }))),
  }) as PublicClient;
  return client;
}

const ZERO = BigInt(0);
const Q96 = 2 ** 96;

/* ---------- ABIs ---------- */

const poolKeyComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "hooks", type: "address" },
  { name: "poolManager", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "parameters", type: "bytes32" },
] as const;

const clPoolManagerAbi = parseAbi([
  "function poolIdToPoolKey(bytes32 id) view returns (address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters)",
  "function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);

const clQuoterAbi = [{
  type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{
    name: "params", type: "tuple", components: [
      { name: "poolKey", type: "tuple", components: poolKeyComponents },
      { name: "zeroForOne", type: "bool" },
      { name: "exactAmount", type: "uint128" },
      { name: "hookData", type: "bytes" },
    ],
  }],
  outputs: [{ name: "amountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }],
}] as const;

const v3PoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  // Only the first slot0 field is read; the rest are static words left undecoded.
  "function slot0() view returns (uint160 sqrtPriceX96)",
]);

const quoterV2Abi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const permit2Abi = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

export const universalRouterAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

/* ---------- Pools ---------- */

type PoolKey = { currency0: Address; currency1: Address; hooks: Address; poolManager: Address; fee: number; parameters: Hex };
type ResolvedPool =
  | { kind: "v3"; address: Address; token0: Address; token1: Address; fee: number }
  | { kind: "infinity-cl"; id: Hex; key: PoolKey };

const resolved = new Map<string, Promise<ResolvedPool | null>>();
const poolKeyOf = (pool: PancakePool) => (pool.kind === "v3" ? pool.address : pool.id).toLowerCase();

/** A pool's immutable facts (tokens, fee, Infinity pool key), read once per session. */
function resolvePool(pool: PancakePool): Promise<ResolvedPool | null> {
  const key = poolKeyOf(pool);
  let found = resolved.get(key);
  if (!found) {
    const c = bscClient();
    found = (pool.kind === "v3"
      ? Promise.all([
        c.readContract({ address: pool.address, abi: v3PoolAbi, functionName: "token0" }),
        c.readContract({ address: pool.address, abi: v3PoolAbi, functionName: "token1" }),
        c.readContract({ address: pool.address, abi: v3PoolAbi, functionName: "fee" }),
      ]).then(([token0, token1, fee]): ResolvedPool => ({ kind: "v3", address: pool.address, token0, token1, fee }))
      : c.readContract({ address: PANCAKE.clPoolManager, abi: clPoolManagerAbi, functionName: "poolIdToPoolKey", args: [pool.id] })
        .then(([currency0, currency1, hooks, poolManager, fee, parameters]): ResolvedPool | null =>
          currency0 === currency1 ? null : { kind: "infinity-cl", id: pool.id, key: { currency0, currency1, hooks, poolManager, fee, parameters } }))
      .catch(() => { resolved.delete(key); return null; });
    resolved.set(key, found);
  }
  return found;
}

const GECKO_POOLS = "https://api.geckoterminal.com/api/v2/networks/bsc/tokens";
const discovered = new Map<string, { at: number; pools: PancakePool[] }>();

/**
 * The token's USDT pools on PancakeSwap v3 and Infinity CL: GeckoTerminal's
 * live list merged with the snapshot in lib/trade/tokens.ts. GeckoTerminal is
 * best effort (it rate-limits), so a failure falls back to the snapshot.
 */
export async function pancakePools(symbol: string, address: string): Promise<PancakePool[]> {
  const snapshot = OPENSTOCKS_POOLS[symbol] ?? [];
  const hit = discovered.get(address.toLowerCase());
  const fresh = hit !== undefined && Date.now() - hit.at < 10 * 60_000;
  let live: PancakePool[] = hit?.pools ?? [];
  if (!fresh) {
    try {
      const response = await fetch(`${GECKO_POOLS}/${address}/pools`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (response.ok) {
        const body = await response.json() as { data?: { attributes?: { address?: string }; relationships?: { dex?: { data?: { id?: string } }; base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } } } }[] };
        const usdt = `bsc_${BSC_USDT.address.toLowerCase()}`;
        live = (body.data ?? []).flatMap((row): PancakePool[] => {
          const dex = row.relationships?.dex?.data?.id;
          const pair = [row.relationships?.base_token?.data?.id?.toLowerCase(), row.relationships?.quote_token?.data?.id?.toLowerCase()];
          const id = row.attributes?.address?.toLowerCase();
          if (!id || !pair.includes(usdt)) { return []; }
          if (dex === "pancakeswap-v3-bsc" && /^0x[0-9a-f]{40}$/.test(id)) { return [{ kind: "v3", address: id as Address }]; }
          if (dex === "pancakeswap-infinity-clmm" && /^0x[0-9a-f]{64}$/.test(id)) { return [{ kind: "infinity-cl", id: id as Hex }]; }
          return [];
        });
        discovered.set(address.toLowerCase(), { at: Date.now(), pools: live });
      }
    } catch { /* snapshot only */ }
  }
  const seen = new Set<string>();
  return [...snapshot, ...live].filter((pool) => {
    const key = poolKeyOf(pool);
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

/* ---------- Quotes ---------- */

export type Side = "buy" | "sell";

export type PancakeQuote = {
  side: Side;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  decimalsIn: number;
  decimalsOut: number;
  /** Total swap fee in pips (1e-6), LP plus protocol share. */
  feePips: number;
  /** Output per input at the pool's current price, before fees. */
  midPrice: number;
  /** Fraction of value lost to moving the price, fees excluded. */
  priceImpact: number;
  pool: ResolvedPool;
  routeLabel: string;
  quotedAt: number;
};

export class QuoteError extends Error {
  constructor(public code: "no-pool" | "no-liquidity" | "network", message: string) { super(message); }
}

const sqrtToPrice = (sqrtPriceX96: bigint) => (Number(sqrtPriceX96) / Q96) ** 2;

async function quotePool(pool: ResolvedPool, tokenIn: Address, tokenOut: Address, amountIn: bigint) {
  const c = bscClient();
  if (pool.kind === "v3") {
    const zeroForOne = pool.token0.toLowerCase() === tokenIn.toLowerCase();
    const [{ result }, sqrtPriceX96] = await Promise.all([
      c.simulateContract({
        address: PANCAKE.v3QuoterV2, abi: quoterV2Abi, functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn, fee: pool.fee, sqrtPriceLimitX96: ZERO }],
      }),
      c.readContract({ address: pool.address, abi: v3PoolAbi, functionName: "slot0" }),
    ]);
    const price = sqrtToPrice(sqrtPriceX96);
    return { amountOut: result[0], feePips: pool.fee, mid: zeroForOne ? price : 1 / price };
  }
  const zeroForOne = pool.key.currency0.toLowerCase() === tokenIn.toLowerCase();
  const [{ result }, slot0] = await Promise.all([
    c.simulateContract({
      address: PANCAKE.clQuoter, abi: clQuoterAbi, functionName: "quoteExactInputSingle",
      args: [{ poolKey: pool.key, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    }),
    c.readContract({ address: PANCAKE.clPoolManager, abi: clPoolManagerAbi, functionName: "getSlot0", args: [pool.id] }),
  ]);
  const [sqrtPriceX96, , protocolFee, lpFee] = slot0;
  // Infinity packs the protocol fee per direction in 12 bits each: low bits for 0->1, high for 1->0.
  const protocol = zeroForOne ? protocolFee & 0xfff : protocolFee >> 12;
  const feePips = Math.round(protocol + lpFee - (protocol * lpFee) / 1_000_000);
  const price = sqrtToPrice(sqrtPriceX96);
  return { amountOut: result[0], feePips, mid: zeroForOne ? price : 1 / price };
}

const feeLabel = (pips: number) => `${(pips / 10_000).toFixed(pips % 100 === 0 ? 2 : 3).replace(/0$/, "")}%`;

/** Best PancakeSwap quote for an exact input: buy spends USDT on the token, sell the reverse. */
export async function quotePancake(args: { symbol: string; token: Address; side: Side; amountIn: bigint }): Promise<PancakeQuote> {
  const { symbol, token, side, amountIn } = args;
  const tokenIn = (side === "buy" ? BSC_USDT.address : token) as Address;
  const tokenOut = (side === "buy" ? token : BSC_USDT.address) as Address;
  const candidates = await pancakePools(symbol, token);
  if (!candidates.length) { throw new QuoteError("no-pool", `No PancakeSwap USDT pool for ${symbol} yet.`); }
  const pools = (await Promise.all(candidates.map(resolvePool))).filter((pool): pool is ResolvedPool => pool !== null);
  if (!pools.length) { throw new QuoteError("network", "Could not read PancakeSwap pools. Check your connection and try again."); }
  const settled = await Promise.allSettled(pools.map(async (pool) => ({ pool, ...(await quotePool(pool, tokenIn, tokenOut, amountIn)) })));
  const quotes = settled.flatMap((entry) => (entry.status === "fulfilled" && entry.value.amountOut > ZERO ? [entry.value] : []));
  if (!quotes.length) {
    throw new QuoteError("no-liquidity", `PancakeSwap pools for ${symbol} have no liquidity in range for this amount.`);
  }
  const best = quotes.reduce((a, b) => (b.amountOut > a.amountOut ? b : a));
  const decimalsIn = side === "buy" ? BSC_USDT.decimals : OPENSTOCKS_DECIMALS;
  const decimalsOut = side === "buy" ? OPENSTOCKS_DECIMALS : BSC_USDT.decimals;
  const outPerIn = (Number(best.amountOut) / 10 ** decimalsOut) / (Number(amountIn) / 10 ** decimalsIn);
  const ideal = best.mid * (1 - best.feePips / 1_000_000);
  const priceImpact = ideal > 0 ? Math.max(0, 1 - outPerIn / ideal) : 0;
  const version = best.pool.kind === "v3" ? "PancakeSwap v3" : "PancakeSwap Infinity";
  const pair = side === "buy" ? `USDT → ${symbol}` : `${symbol} → USDT`;
  return {
    side, tokenIn, tokenOut, amountIn, amountOut: best.amountOut, decimalsIn, decimalsOut,
    feePips: best.feePips, midPrice: best.mid, priceImpact, pool: best.pool,
    routeLabel: `${pair} · ${version} · ${feeLabel(best.feePips)} pool`,
    quotedAt: Date.now(),
  };
}

/** The least output the swap accepts: the quote less the slippage tolerance (in basis points). */
export const minimumOut = (amountOut: bigint, slippageBps: number) =>
  (amountOut * BigInt(10_000 - Math.round(slippageBps))) / BigInt(10_000);

/* ---------- Swap calldata ---------- */

const COMMAND = { V3_SWAP_EXACT_IN: 0x00, PERMIT2_PERMIT: 0x0a, INFI_SWAP: 0x10 } as const;
const ACTION = { CL_SWAP_EXACT_IN_SINGLE: 0x06, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f } as const;

export type PermitSingle = {
  details: { token: Address; amount: bigint; expiration: number; nonce: number };
  spender: Address;
  sigDeadline: bigint;
};

/** EIP-712 typed data for a Permit2 PermitSingle that lets the Universal Router pull `amount` of `token`. */
export function permitTypedData(permit: PermitSingle) {
  return {
    domain: { name: "Permit2", chainId: bsc.id, verifyingContract: PANCAKE.permit2 as Address },
    types: {
      PermitDetails: [
        { name: "token", type: "address" }, { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" },
      ],
      PermitSingle: [
        { name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" },
      ],
    },
    primaryType: "PermitSingle" as const,
    message: permit,
  };
}

/**
 * Universal Router calldata for an exact-input swap through the quoted pool,
 * paid by the sender via Permit2. A v3 swap pays out to `recipient`; an
 * Infinity swap's TAKE_ALL always pays the sender, which is the same wallet. When a signed
 * permit is given it is applied first, in the same transaction.
 */
export function buildSwapCall(args: {
  quote: PancakeQuote; minOut: bigint; recipient: Address; deadline: bigint;
  permit?: { permit: PermitSingle; signature: Hex };
}): { to: Address; data: Hex } {
  const { quote, minOut, recipient, deadline, permit } = args;
  const commands: number[] = [];
  const inputs: Hex[] = [];
  if (permit) {
    commands.push(COMMAND.PERMIT2_PERMIT);
    inputs.push(encodeAbiParameters(
      [{
        type: "tuple", components: [
          { name: "details", type: "tuple", components: [
            { name: "token", type: "address" }, { name: "amount", type: "uint160" },
            { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" },
          ] },
          { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" },
        ],
      }, { type: "bytes" }],
      [permit.permit, permit.signature],
    ));
  }
  if (quote.pool.kind === "v3") {
    commands.push(COMMAND.V3_SWAP_EXACT_IN);
    const path = encodePacked(["address", "uint24", "address"], [quote.tokenIn, quote.pool.fee, quote.tokenOut]);
    inputs.push(encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
      [recipient, quote.amountIn, minOut, path, true],
    ));
  } else {
    commands.push(COMMAND.INFI_SWAP);
    const zeroForOne = quote.pool.key.currency0.toLowerCase() === quote.tokenIn.toLowerCase();
    const actions = encodePacked(["uint8", "uint8", "uint8"], [ACTION.CL_SWAP_EXACT_IN_SINGLE, ACTION.SETTLE_ALL, ACTION.TAKE_ALL]);
    const swapParams = encodeAbiParameters(
      [{
        type: "tuple", components: [
          { name: "poolKey", type: "tuple", components: poolKeyComponents },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      }],
      [{ poolKey: quote.pool.key, zeroForOne, amountIn: quote.amountIn, amountOutMinimum: minOut, hookData: "0x" }],
    );
    const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quote.tokenIn, quote.amountIn]);
    const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [quote.tokenOut, minOut]);
    inputs.push(encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swapParams, settle, take]]));
  }
  const commandBytes = `0x${commands.map((command) => command.toString(16).padStart(2, "0")).join("")}` as Hex;
  return {
    to: PANCAKE.universalRouter as Address,
    data: encodeFunctionData({ abi: universalRouterAbi, functionName: "execute", args: [commandBytes, inputs, deadline] }),
  };
}

export const MAX_UINT256 = maxUint256;
/** Permit2's allowance amount is a uint160. */
export const MAX_UINT160 = (BigInt(1) << BigInt(160)) - BigInt(1);
