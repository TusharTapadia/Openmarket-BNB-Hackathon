"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CompanyView } from "@/lib/coverage-view";
import { Logo } from "./pro-shell";

/**
 * Company filter as a dropdown: a button showing the selection (logos and a
 * count), opening a checklist with each company's logo and market count.
 * Empty selection means every company.
 */
export function CompanyFilter({ companies, selected, onChange, count }: {
  companies: CompanyView[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Markets each company has under the current asset-type filter. */
  count: (company: CompanyView) => number;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { return; }
    const outside = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) { setOpen(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const chosen = companies.filter((company) => selected.includes(company.slug));
  const label = chosen.length === 0 ? "All companies" : chosen.length === 1 ? chosen[0].name : `${chosen.length} companies`;
  const toggle = (slug: string) => onChange(selected.includes(slug) ? selected.filter((item) => item !== slug) : [...selected, slug]);

  return <div className="p-dd" ref={box}>
    <button type="button" className="p-dd-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      {chosen.length > 0 && <span className="p-dd-logos">{chosen.slice(0, 3).map((company) => <Logo key={company.slug} name={company.name} logo={company.logo} size={18} />)}</span>}
      <span>{label}</span>
      <ChevronDown size={14} aria-hidden />
    </button>
    {open && <div className="p-dd-menu" role="listbox" aria-multiselectable="true" aria-label="Companies">
      {companies.map((company) => {
        const markets = count(company);
        return <label key={company.slug} className={`p-dd-item ${markets ? "" : "zero"}`} role="option" aria-selected={selected.includes(company.slug)}>
          <input type="checkbox" checked={selected.includes(company.slug)} onChange={() => toggle(company.slug)} />
          <Logo name={company.name} logo={company.logo} size={20} />
          <span className="p-grow">{company.name}</span>
          <span className="p-mono p-faint">{markets}</span>
        </label>;
      })}
      <div className="p-dd-foot">
        <button type="button" onClick={() => onChange([])}>Clear</button>
        <button type="button" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>}
  </div>;
}
