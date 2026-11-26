"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";
import { quoteJupiter, JupiterError } from "@/lib/trade/jupiter";
import { quotePancake, QuoteError, type Side } from "@/lib/trade/pancakeswap";

/** Quotes refresh this often while the modal is open and idle. */
export const QUOTE_REFRESH_MS = 15_000;

export function useDebounced<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** A typed amount as base units, or null when it is empty, malformed or zero. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const clean = text.trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") { return null; }
  try {
    const value = parseUnits(clean, decimals);
    return value > BigInt(0) ? value : null;
  } catch {
    return null;
  }
}

/** Retry network hiccups, not answers: "no pool" and "no liquidity" are final. */
const retryNetwork = (count: number, error: Error) =>
  count < 2 && !((error instanceof QuoteError || error instanceof JupiterError) && error.code !== "network");

export function usePancakeQuote(args: { symbol: string; token: Address; side: Side; amountIn: bigint | null; paused: boolean }) {
  const { symbol, token, side, amountIn, paused } = args;
  return useQuery({
    queryKey: ["trade-quote", "pancake", token, side, amountIn?.toString() ?? ""],
    queryFn: () => quotePancake({ symbol, token, side, amountIn: amountIn as bigint }),
    enabled: amountIn !== null,
    refetchInterval: paused ? false : QUOTE_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    retry: retryNetwork,
    placeholderData: keepPreviousData,
  });
}

export function useJupiterQuote(args: { symbol: string; mint: string; side: Side; amountIn: number | null }) {
  const { symbol, mint, side, amountIn } = args;
  return useQuery({
    queryKey: ["trade-quote", "jupiter", mint, side, amountIn ?? 0],
    queryFn: () => quoteJupiter({ mint, symbol, side, amountIn: amountIn as number, slippageBps: 50 }),
    enabled: amountIn !== null && amountIn > 0,
    refetchInterval: QUOTE_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    retry: retryNetwork,
    placeholderData: keepPreviousData,
  });
}
