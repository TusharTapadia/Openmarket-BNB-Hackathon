"use client";

import { useState } from "react";
import Image from "next/image";

/**
 * Round logos for the provider that runs a market and the venue it trades on,
 * overlapping like a stacked avatar pair: the provider in front, the venue
 * peeking out behind it. When the two are the same (Gate on Gate), one circle.
 *
 * Files live in public/venue-logos. A name without a file falls back to its
 * initials in a grey circle.
 */

const FILES: Record<string, string> = {
  aerodrome: "aerodrome.png", aster: "aster.jpg", atlasoracle: "atlas-oracle.svg", binance: "binance.svg", bingx: "bingx.png", bitget: "bitget.svg", bitunix: "bitunix.png", bnbchain: "bnb-chain.png", bybit: "bybit.png",
  coinmarketcap: "coinmarketcap.svg", coinw: "coinw.png", colb: "colb.png", cryptocom: "cryptocom.png", entropyio: "entropyio.svg", extended: "extended.png", gate: "gate.png",
  htx: "htx.png", hyperliquid: "hyperliquid.png", kraken: "kraken.png", kucoin: "kucoin.png", lbank: "lbank.png",
  lighter: "lighter.jpg", meteora: "meteora.png", metric: "metric.png", mexc: "mexc.png", nasdaq: "nasdaq.svg", offchainprivatemarkets: "opm.svg", okx: "okx.svg", paragon: "paragon.png", phemex: "phemex.png",
  ondo: "ondo.png", openstocks: "openstocks-1.png", paimon: "paimon.png", orca: "orca.png", pancakeswap: "pancakeswap.png", prestocks: "prestocks.png", raydium: "raydium.png", solana: "solana.png", tessera: "tessera.png", uniswap: "uniswap.png", variational: "variational.png", ventuals: "ventuals.png",
  xstocks: "xstocks.jpg", xyz: "xyz.png",
};

/**
 * Logos drawn in light colours on a transparent ground, with the dark backing
 * each is shown on so it stays visible on white. Checked by rendering every
 * file in public/venue-logos on a white circle: these five vanish or wash out.
 */
const DARK_GROUND: Record<string, string> = {
  hyperliquid: "#072723", // Hyperliquid's own dark teal behind its mint mark
  entropyio: "#0f1a2b",
  paragon: "#0f1a2b",
  xyz: "#0f1a2b",
  openstocks: "#0f1a2b", // a white mark on a transparent ground
};

/** Feed names that differ from the file key. */
const ALIASES: Record<string, string> = {
  aeroslipstream: "aerodrome", meteoradlmm: "meteora", meteoradamm: "meteora", ondostocks: "ondo",
  "trade.xyz": "xyz", "tradexyz": "xyz", "entropy": "entropyio", "cryptocom": "cryptocom", "gateio": "gate",
};

const normaliseLogoName = (name: string) => name.toLowerCase().replace(/[^a-z0-9.]/g, "");

export function logoKey(name: string): string | null {
  const key = normaliseLogoName(name);
  if (FILES[key]) { return key; }
  if (ALIASES[key]) { return ALIASES[key]; }
  // DEX listings often append a chain or a protocol version.
  const protocol = normaliseLogoName(name.replace(/\s+\([^()]+\)$/, "").replace(/\s+v\d+$/i, ""));
  if (FILES[protocol]) { return protocol; }
  if (ALIASES[protocol]) { return ALIASES[protocol]; }
  // Issuer tokens: "Wrapped Anthropic xStock" is an xStocks product.
  if (key.includes("xstock")) { return "xstocks"; }
  if (key.includes("prestock")) { return "prestocks"; }
  if (key.includes("openstock")) { return "openstocks"; }
  return null;
}

export function logoSrc(name: string): string | null {
  const key = logoKey(name);
  return key ? `/venue-logos/${FILES[key]}` : null;
}

function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return parts.length ? (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? "")).toUpperCase() : "?";
}

/** One round logo. */
export function VenueLogo({ name, size = 22, className = "" }: { name: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoSrc(name);
  const ground = DARK_GROUND[logoKey(name) ?? ""];
  return <span className={`xm-logo ${className} ${ground ? "on-dark" : ""}`} style={{ width: size, height: size, fontSize: Math.max(8, size * 0.4), background: ground && src && !failed ? ground : undefined }} title={name}>
    {src && !failed ? <Image src={src} alt="" width={size} height={size} unoptimized onError={() => setFailed(true)} /> : initials(name)}
  </span>;
}

/**
 * Provider in front, venue behind it and offset to the side. `venue` is the
 * venue's display name; pass null to show the provider alone.
 */
export function ExchangeMark({ provider, venue, size = 22 }: { provider: string; venue: string | null; size?: number }) {
  const same = !venue || logoKey(provider) === logoKey(venue) || provider.toLowerCase() === venue.toLowerCase();
  return <span className={`xm-stack ${same ? "single" : ""}`} aria-hidden style={{ height: size }}>
    <VenueLogo name={provider} size={size} className="front" />
    {!same && <VenueLogo name={venue!} size={size} className="back" />}
  </span>;
}

/** True when a provider is the venue itself (MEXC on MEXC), so there is nothing to say underneath. */
export function sameMark(provider: string, venue: string): boolean {
  const key = logoKey(provider);
  return provider.toLowerCase() === venue.toLowerCase() || (key !== null && key === logoKey(venue));
}

/**
 * An exchange cell: the venue's logo and name, with the provider that runs the
 * market underneath as a small logo and its name. When the provider is the
 * venue, the second line is left out.
 */
export function VenueCell({ venue, provider, size = 28 }: { venue: string; provider: string | null; size?: number }) {
  const showProvider = !!provider && !sameMark(provider, venue);
  return <span className="xm-cell">
    <VenueLogo name={venue} size={size} />
    <span className="xm-cell-text">
      <span className="xm-cell-name">{venue}</span>
      {showProvider && <span className="xm-cell-sub" title={provider!}><VenueLogo name={provider!} size={14} /><span>{provider}</span></span>}
    </span>
  </span>;
}
