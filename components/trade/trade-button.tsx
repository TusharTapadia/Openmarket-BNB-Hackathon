"use client";

import { useState, type MouseEvent } from "react";
import type { Address } from "viem";
import { TradeModal, type TradeTarget } from "@/components/trade/trade-modal";
import { findOpenstocksToken, OPENSTOCKS_APP, PRESTOCKS_MINTS, prestocksPage, xstocksPage } from "@/lib/trade/tokens";

type Props = { issuer: "PreStocks" | "OpenStocks" | "xStocks" | "Paimon"; symbol: string; companySlug: string; companyName: string };

/** What a Trade button does for an issuer token: open the quote modal, or hand off to the venue. */
function resolve({ issuer, symbol, companySlug }: Props): { target: TradeTarget } | { href: string } {
  if (issuer === "OpenStocks" || issuer === "Paimon") {
    const token = findOpenstocksToken(companySlug, symbol);
    return token?.address ? { target: { venue: "pancakeswap", symbol: token.symbol, address: token.address as Address } } : { href: OPENSTOCKS_APP };
  }
  if (issuer === "PreStocks") {
    const mint = PRESTOCKS_MINTS[symbol.toUpperCase()];
    return mint ? { target: { venue: "jupiter", symbol: symbol.toUpperCase(), mint, pageUrl: prestocksPage(symbol) } } : { href: prestocksPage(symbol) };
  }
  return { href: xstocksPage(symbol) };
}

/**
 * A small "Trade" button for one issuer token. OpenStocks tokens open a
 * PancakeSwap quote and swap on BNB Chain; PreStocks tokens open a Jupiter
 * quote with a hand-off to Jupiter or PreStocks; xStocks links to its venue.
 */
export function TradeButton(props: Props) {
  const { issuer, symbol, companyName } = props;
  const [open, setOpen] = useState(false);
  const resolved = resolve(props);
  // Rows in the markets table can be links; keep a click here from also following the row.
  const contain = (event: MouseEvent) => event.stopPropagation();

  if ("href" in resolved) {
    return (
      <a className="trade-btn" href={resolved.href} target="_blank" rel="noreferrer" onClick={contain}>
        Trade<span className="sr-only"> {symbol} on {issuer} (opens in new tab)</span>
      </a>
    );
  }
  return (
    <>
      <button
        type="button"
        className="trade-btn"
        aria-haspopup="dialog"
        onClick={(event) => { event.preventDefault(); contain(event); setOpen(true); }}
      >
        Trade<span className="sr-only"> {symbol}</span>
      </button>
      {open ? <TradeModal target={resolved.target} companyName={companyName} issuer={issuer} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
