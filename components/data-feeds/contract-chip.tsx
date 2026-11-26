"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { VenueLogo } from "@/components/exchange-mark";
import { shortAddress } from "./shared";

/**
 * A contract address on BNB Chain: the chain's logo, the short address linked
 * to the explorer, and a button that copies the full address.
 */
export function ContractChip({ address, explorer, label }: { address: string; explorer: { name: string; url: string } | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) { return; }
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard blocked (insecure origin or permissions): select-and-copy from the title instead.
      window.prompt("Copy the contract address", address);
    }
  }

  const name = label ? `${label} contract` : "Contract";
  return <span className="df-chip">
    <VenueLogo name="BNB Chain" size={16} />
    {explorer
      ? <a className="df-chip-addr df-num" href={`${explorer.url}/address/${address}`} target="_blank" rel="noopener noreferrer" title={address} aria-label={`${name} ${address} on ${explorer.name}, opens in a new tab`}>
        {shortAddress(address)}<ExternalLink size={11} aria-hidden />
      </a>
      : <span className="df-chip-addr df-num" title={address}>{shortAddress(address)}</span>}
    <button type="button" className="df-chip-copy" onClick={copy} aria-label={copied ? "Copied" : `Copy ${name.toLowerCase()} address`} title={copied ? "Copied" : "Copy address"}>
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
    </button>
    <span className="sr-only" aria-live="polite">{copied ? "Address copied" : ""}</span>
  </span>;
}
