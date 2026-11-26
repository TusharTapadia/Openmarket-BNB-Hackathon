"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { formatPrice } from "@/app/data";
import { useRemoteData } from "@/hooks/use-market-data";
import { compactUsd } from "@/lib/coverage-view";
import type { ValuationCompany } from "@/lib/offchain";
import { CompanyMark } from "@/components/company-mark";
import { InfoTip } from "@/components/info-tip";
import { SkeletonLines } from "@/components/skeleton";

/**
 * Valuation calculator (Lite): pick a company from AllocationsX's list, type a
 * share price or a valuation, and get the other from AllocationsX's share
 * count. Whichever field was typed in last is the input; the other is derived.
 */

type Payload = { asOf: string | null; companies: ValuationCompany[] };
type Editing = "price" | "valuation";

const QUICK: { amount: number; label: string }[] = [{ amount: 1e9, label: "1B" }, { amount: 1e10, label: "10B" }, { amount: 1e11, label: "100B" }, { amount: 1e12, label: "1T" }];
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, bn: 1e9, t: 1e12 };
const shares = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "100B", "$1.2t", "2,500,000" → a number; anything else → null. */
export function parseAmount(text: string): number | null {
  const match = text.trim().toLowerCase().replace(/[$,\s]/g, "").match(/^(\d*\.?\d+)(k|m|bn|b|t)?$/);
  if (!match) { return null; }
  const value = Number(match[1]) * (match[2] ? SUFFIX[match[2]] : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const plainPrice = (value: number) => value >= 100 ? value.toFixed(2) : value >= 1 ? value.toFixed(2) : value.toPrecision(3);
const plainValuation = (value: number) => compactUsd(value).replace(/^\$/, "");

export function ValuationCalculator() {
  const { data, loading, error } = useRemoteData<Payload>("/api/valuation-companies");
  const companies = useMemo(() => data?.companies ?? [], [data]);
  const [slug, setSlug] = useState<string | null>("anthropic");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState<Editing>("price");
  const [priceText, setPriceText] = useState("");
  const [valuationText, setValuationText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const company = companies.find((item) => item.slug === slug) ?? null;
  const matches = companies.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);

  const price = editing === "price" ? parseAmount(priceText) : null;
  const valuation = editing === "valuation" ? parseAmount(valuationText) : null;
  const derivedValuation = company && price !== null ? price * company.totalShares : null;
  const derivedPrice = company && valuation !== null ? valuation / company.totalShares : null;

  function pick(next: ValuationCompany) {
    setSlug(next.slug); setQuery(""); setOpen(false);
  }
  function clearCompany() {
    setSlug(null); setQuery(""); setOpen(true);
    requestAnimationFrame(() => input.current?.focus());
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, matches.length - 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    else if (event.key === "Enter" && open && matches[active]) { event.preventDefault(); pick(matches[active]); }
    else if (event.key === "Escape") { setOpen(false); }
  }
  function quickSet(label: string) {
    setEditing("valuation"); setValuationText(label); setPriceText("");
  }
  function useOffchain() {
    if (!company?.sharePrice) { return; }
    setEditing("price"); setPriceText(plainPrice(company.sharePrice)); setValuationText("");
  }

  const priceValue = editing === "price" ? priceText : derivedPrice !== null ? plainPrice(derivedPrice) : "";
  const valuationValue = editing === "valuation" ? valuationText : derivedValuation !== null ? plainValuation(derivedValuation) : "";
  const result = editing === "price" ? derivedValuation : derivedPrice;
  const resultLabel = editing === "price" ? "Estimated valuation" : "Implied share price";

  return <section className="pc-card vc-section" id="valuation-calculator" aria-labelledby="vc-h">
    <div className="vc-head">
      <h2 id="vc-h" className="pc-h2">Valuation calculator</h2>
      <p className="mk-note">Type a share price to see the company valuation it implies, or a valuation to see the share price. Both use AllocationsX&apos;s count of shares outstanding.</p>
    </div>
    {loading ? <div className="vc-body"><SkeletonLines lines={4} label="Loading AllocationsX companies" /></div>
      : error && !companies.length ? <p className="vc-error">AllocationsX market data is unavailable right now. Try again shortly.</p>
      : <div className="vc-body">
        <div className="vc-form">
          <div className="vc-field">
            <label className="vc-label" htmlFor={`${listId}-input`}>Company</label>
            {company ? <div className="vc-picked">
              <span className="vc-logo"><CompanyMark name={company.name} logo={company.logo} /></span>
              <span className="vc-picked-name">{company.name}</span>
              <button type="button" className="vc-clear" onClick={clearCompany} aria-label={`Clear ${company.name} and pick another company`}><X size={16} /></button>
            </div>
              : <div className="vc-combo">
                <input ref={input} id={`${listId}-input`} className="vc-input" type="text" role="combobox" autoComplete="off"
                  aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
                  aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].slug}` : undefined}
                  placeholder={`Search ${companies.length} companies`} value={query}
                  onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }}
                  onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} onKeyDown={onKey} />
                {open && <ul className="vc-options" id={listId} role="listbox" aria-label="Companies">
                  {matches.length ? matches.map((item, index) => <li key={item.slug} id={`${listId}-${item.slug}`} role="option" aria-selected={index === active}
                    className="vc-option" onMouseDown={(event) => { event.preventDefault(); pick(item); }} onMouseEnter={() => setActive(index)}>
                    <span className="vc-logo small"><CompanyMark name={item.name} logo={item.logo} /></span>{item.name}
                  </li>) : <li className="vc-option none" role="option" aria-selected={false} aria-disabled>No company matches</li>}
                </ul>}
              </div>}
          </div>

          <div className="vc-pair">
            <div className="vc-field">
              <span className="vc-label-row"><label className="vc-label" htmlFor={`${listId}-price`}>Share price</label>{editing === "price" && <span className="vc-chip">Editing</span>}</span>
              <span className={`vc-money ${editing === "price" ? "on" : ""}`}>
                <span aria-hidden>$</span>
                <input id={`${listId}-price`} className="vc-amount" inputMode="decimal" placeholder="Enter price" value={priceValue} disabled={!company}
                  onChange={(event) => { setEditing("price"); setPriceText(event.target.value); }} aria-describedby={`${listId}-price-hint`} />
              </span>
              <small className="vc-hint" id={`${listId}-price-hint`}>{editing === "valuation" && derivedPrice !== null ? "Implied from valuation" : "Per share, in US dollars"}</small>
            </div>
            <div className="vc-field">
              <span className="vc-label-row"><label className="vc-label" htmlFor={`${listId}-valuation`}>Valuation</label>{editing === "valuation" && <span className="vc-chip">Editing</span>}</span>
              <span className={`vc-money ${editing === "valuation" ? "on" : ""}`}>
                <span aria-hidden>$</span>
                <input id={`${listId}-valuation`} className="vc-amount" inputMode="decimal" placeholder="100B" value={valuationValue} disabled={!company}
                  onChange={(event) => { setEditing("valuation"); setValuationText(event.target.value); }} aria-describedby={`${listId}-valuation-hint`} />
              </span>
              <small className="vc-hint" id={`${listId}-valuation-hint`}>{editing === "price" && derivedValuation !== null ? "Implied from share price" : "Use K, M, B or T, e.g. 100B"}</small>
            </div>
          </div>

          <div className="vc-quick" role="group" aria-label="Quick set a valuation">
            <span className="vc-label">Quick set</span>
            {QUICK.map((item) => <button key={item.amount} type="button" className="pc-chip" disabled={!company} onClick={() => quickSet(item.label)}>${item.label} valuation</button>)}
            {company?.sharePrice && <button type="button" className="pc-chip vc-offchain" onClick={useOffchain}>Off-chain price {formatPrice(company.sharePrice)}</button>}
          </div>
        </div>

        <div className="vc-result" aria-live="polite">
          <span className="vc-result-label">{resultLabel}
            <InfoTip label={`How the ${resultLabel.toLowerCase()} is worked out`}>
              {editing === "price" ? "Share price × shares outstanding." : "Valuation ÷ shares outstanding."} The share count is AllocationsX&apos;s figure for fully diluted shares. It is an estimate: share classes and option pools can make a real round price differ.
            </InfoTip>
          </span>
          <strong className="vc-result-value">{result === null ? "—" : editing === "price" ? compactUsd(result) : formatPrice(result)}</strong>
          <span className="vc-result-sub">{company ? `${company.name}, ${shares.format(company.totalShares)} shares outstanding` : "Pick a company to start"}</span>
          {company && (company.sharePrice || company.valuation) && <span className="vc-result-ref">
            AllocationsX reference: {company.sharePrice ? `${formatPrice(company.sharePrice)} a share` : ""}{company.sharePrice && company.valuation ? ", " : ""}{company.valuation ? `${compactUsd(company.valuation)} valuation` : ""}
          </span>}
        </div>
      </div>}
    <p className="vc-foot">Estimates derive from the latest AllocationsX market data and refresh hourly. For informational purposes only, not investment advice.</p>
  </section>;
}
