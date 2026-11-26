/**
 * Token tables the trade flow needs, kept free of server imports so client
 * components can read them. lib/issuers.ts re-exports OPENSTOCKS_TOKENS from
 * here, so the server code reads the same table.
 */

/**
 * OpenStocks' tokens on BNB Chain, from its app's own token config. Each
 * company has a pre-IPO token (oANTHROPIC); a company that has listed also has
 * a public token (oANTHROPICx) that the pre-IPO token converts into once its
 * shares unlock. GeckoTerminal (no key needed) reads both on-chain: pool price,
 * supply value, 24h volume and holder count.
 */
export type OpenstocksToken = { symbol: string; address: string; kind: "pre-IPO" | "public" };
export const OPENSTOCKS_TOKENS: Record<string, OpenstocksToken[]> = {
  anthropic: [
    { symbol: "oANTHROPIC", address: "0x24B518b332543a4E1C3649d063daB199d103760a", kind: "pre-IPO" },
    { symbol: "oANTHROPICx", address: "0x6bb8e7c942512fc141BC3429BAA8255e10c1cB3C", kind: "public" },
  ],
  openai: [{ symbol: "oOPENAI", address: "0xd25b3D6DEB9332BB5951C0318d9f357B1F0DEF71", kind: "pre-IPO" }],
  anduril: [{ symbol: "oANDURIL", address: "0x5dcb20b5B75110B5F28387D8D3Bdd727a43310d5", kind: "pre-IPO" }],
  neuralink: [{ symbol: "oNEURALINK", address: "0xFb7F44e71D03adf619BeA2055437eC6453AB2552", kind: "pre-IPO" }],
  "figure-ai": [{ symbol: "oFIGUREAI", address: "0xF9D15fA2adF7942610E8A416363e037859F99E92", kind: "pre-IPO" }],
  polymarket: [{ symbol: "oPOLYMARKET", address: "0x9451ECD46c3E8Fab8078b933862305f14ECbE1AD", kind: "pre-IPO" }],
};

/**
 * Paimon Finance's Pre-Access SPV tokens on BNB Chain (paimon.finance). pPOLY
 * is a plain BEP-20 (18 decimals) for an SPV holding Polymarket; Paimon does
 * not publish shares per token. CoinMarketCap lists a 1B max supply, so one
 * token reads as the company valuation in billions.
 */
export const PAIMON_TOKENS: Record<string, OpenstocksToken[]> = {
  polymarket: [{ symbol: "pPOLY", address: "0x1D80392D12CAAaF9E333Bb0bb7f021eaCf297Fe6", kind: "pre-IPO" }],
};
export const PAIMON_APP = "https://app.paimon.finance/";

/** A BNB Chain issuer token (OpenStocks or Paimon) by symbol, looked up under the company first. */
export function findOpenstocksToken(companySlug: string, symbol: string): OpenstocksToken | null {
  const wanted = symbol.toLowerCase();
  const own = [...(OPENSTOCKS_TOKENS[companySlug] ?? []), ...(PAIMON_TOKENS[companySlug] ?? [])];
  return own.find((token) => token.symbol.toLowerCase() === wanted)
    ?? [...Object.values(OPENSTOCKS_TOKENS), ...Object.values(PAIMON_TOKENS)].flat().find((token) => token.symbol.toLowerCase() === wanted)
    ?? null;
}

/* ---------- BNB Chain (chain id 56) ---------- */

/** Binance-Peg BSC-USD, 18 decimals. Every OpenStocks pool quotes against it. */
export const BSC_USDT = { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 } as const;
/** All OpenStocks tokens use 18 decimals (read on-chain via decimals()). */
export const OPENSTOCKS_DECIMALS = 18;

/**
 * PancakeSwap contracts on BSC. Sources:
 * - v3: github.com/pancakeswap/pancake-v3-contracts deployments/bscMainnet.json
 * - Infinity: github.com/pancakeswap/infinity-periphery script/config/bsc-mainnet.json
 * - Universal Router: github.com/pancakeswap/infinity-universal-router deploy-addresses/bsc-mainnet.json
 */
export const PANCAKE = {
  v3QuoterV2: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  v3Factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  clPoolManager: "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b",
  clQuoter: "0xd0737C9762912dD34c3271197E362Aa736Df0926",
  vault: "0x238a358808379702088667322f80aC48bAd5e6c4",
  universalRouter: "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB",
  permit2: "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
} as const;

/** A PancakeSwap pool the quote may route through: a v3 pool address, or an Infinity CL pool id. */
export type PancakePool = { kind: "v3"; address: `0x${string}` } | { kind: "infinity-cl"; id: `0x${string}` };

/**
 * USDT pools for each OpenStocks token, as GeckoTerminal listed them
 * (networks/bsc/tokens/{address}/pools, PancakeSwap v3 and Infinity CLMM only).
 * The quote also asks GeckoTerminal for new pools at run time and merges them
 * in; this list is the fallback when that call fails. Pools that are empty or
 * out of range simply fail to quote and are skipped.
 */
export const OPENSTOCKS_POOLS: Record<string, PancakePool[]> = {
  pPOLY: [{ kind: "v3", address: "0xb2c8244fbeee2da006b5d9cf09908081f807c649" }],
  oANTHROPIC: [
    { kind: "v3", address: "0xb73bf82392b1b9f91a934cd3220cfa3732d10d85" },
    { kind: "infinity-cl", id: "0xf09e05834ba2ab6d109c3b72692295a964f53768ac5b62ea0fa2ac09e51ef14c" },
    { kind: "infinity-cl", id: "0xbf734923061ccb2cf58a347bb69fbc08145aa6e5e35eb930abc48d0e1551277c" },
    { kind: "infinity-cl", id: "0xa0058e0f2f734561379692044ecbba3547d3fc8299285efb3a313921e7d05078" },
  ],
  oANTHROPICx: [
    { kind: "infinity-cl", id: "0x96b1ec98d83d420d8d2aad11dc54802a97e3d4f6ed68fd0e14186b04e8facbf6" },
    { kind: "v3", address: "0x386dbb76fa9159a25d675f02e2579b8fc53f9d24" },
  ],
  oOPENAI: [{ kind: "infinity-cl", id: "0x76c94774edaee9f1a851dc6711110b799e837beb64a7fbc7b203d96e1a927a1c" }],
  oANDURIL: [
    { kind: "infinity-cl", id: "0x66a521ee4fd50254b62a8971e9b9e4d964d2cddf94c360961c080c09f5e51bed" },
    { kind: "infinity-cl", id: "0xcc3f8e13449f66a01e84d9ae8d4387bc840891fccb563b075c5e6a53cbba1d8c" },
  ],
  oNEURALINK: [
    { kind: "v3", address: "0x0d7c8cbc3461f618b90dcc3d871f2e6275d660e0" },
    { kind: "infinity-cl", id: "0x8ebd3fd4e6094a078665be5c4984666c526ea8996bd169ed0e591d2161bd40cf" },
  ],
  oFIGUREAI: [
    { kind: "infinity-cl", id: "0x79f8838672f11e4cca5cf892944c5f824794d58253bd310cc519951a8e6de9a0" },
    { kind: "infinity-cl", id: "0x005b2ca8ea5cd31b9fafc63fbf3b99a40bfa131b6be2d5d0d1e4e584bec7225a" },
  ],
  oPOLYMARKET: [],
};

/* ---------- Solana (PreStocks) ---------- */

/** Circle USDC on Solana, 6 decimals. */
export const SOLANA_USDC = { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 } as const;

/**
 * PreStocks' Token-2022 mints on Solana, from prestocks.com/api/prestocks
 * (contract_address) and /api/metrics (splMint). Decimals and the UI
 * multiplier are read from the mint at quote time.
 */
export const PRESTOCKS_MINTS: Record<string, string> = {
  ANTHROPIC: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
  ANDURIL: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
  DATABRICKS: "PreDc2cmtrna6MC8z6pYMoQJbbJGAuimCK3AxQ81ZpQ",
  FIGUREAI: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd",
  KALSHI: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua",
  NEURALINK: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S",
  OPENAI: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
  OURA: "Pre9atBqkocK1QngFy7Q7zvyQictEFpXdLi6bZ2qnYy",
  POLYMARKET: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP",
  SPACEX: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
  XAI: "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx",
  RAMP: "Pre5Ygpr1i66wM2Jgx22KSXfqG1nzbu6MidxjWkDWht",
};

export const prestocksPage = (symbol: string) => `https://www.prestocks.com/${symbol.toLowerCase()}`;
export const jupiterSwapUrl = (sellMint: string, buyMint: string) =>
  `https://jup.ag/swap?sell=${encodeURIComponent(sellMint)}&buy=${encodeURIComponent(buyMint)}`;

/* ---------- Venue links ---------- */

export const OPENSTOCKS_APP = "https://app.openstocks.xyz/trade";
export const xstocksPage = (symbol: string) => `https://defi.xstocks.fi/${encodeURIComponent(symbol)}`;
export const bscscanTx = (hash: string) => `https://bscscan.com/tx/${hash}`;
