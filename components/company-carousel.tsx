"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { changeOver, formatPrice, formatSignedPercent } from "@/app/data";
import { compactUsd, fundingText, plural, type CompanyView } from "@/lib/coverage-view";
import { Mark, Pct, Spark } from "@/components/pc";
import { InfoTip } from "@/components/info-tip";
import { SkeletonLines } from "@/components/skeleton";

/**
 * One company at a time, built around its volume-weighted price: every market
 * on the company's main price basis, each weighted by what it traded in the
 * last 24 hours (30 days where no market reports a day's volume). Markets that
 * quote a different unit are left out, as they are from the medians elsewhere.
 *
 * Advances every eight seconds; hovering, focusing or pausing stops it, and
 * reduced motion never starts it.
 */

const INTERVAL_MS = 8000;

export type WeightedPrice = { price: number; markets: number; weight: "24h" | "30d" };

export function weightedPrice(company: CompanyView): WeightedPrice | null {
  const priced = company.main.filter((row) => row.price !== null && row.price > 0);
  for (const weight of ["24h", "30d"] as const) {
    const rows = priced.map((row) => ({ price: row.price!, volume: (weight === "24h" ? row.volume24hUsd : row.volume30dUsd) ?? 0 })).filter((row) => row.volume > 0);
    const total = rows.reduce((sum, row) => sum + row.volume, 0);
    if (total > 0) { return { price: rows.reduce((sum, row) => sum + row.price * row.volume, 0) / total, markets: rows.length, weight }; }
  }
  return null;
}

export function CompanyCarousel({ companies, loading }: { companies: CompanyView[]; loading: boolean }) {
  // Companies with a weighted price, busiest first.
  const slides = companies.map((company) => ({ company, weighted: weightedPrice(company) }))
    .filter((slide) => slide.weighted !== null)
    .sort((a, b) => b.company.totals.volume24hUsd - a.company.totals.volume24hUsd);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [held, setHeld] = useState(false);
  const [still, setStill] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const count = slides.length;
  const current = count ? index % count : 0;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setStill(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const auto = playing && !held && !still && count > 1;
  useEffect(() => {
    if (!auto) { return; }
    const timer = setInterval(() => setIndex((value) => value + 1), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [auto]);

  const go = (step: number) => setIndex((value) => ((value % count) + step + count) % count);

  if (loading || !count) {
    return <section className="pc-card cc-section" aria-label="Company spotlight">
      <div className="cc-body">{loading ? <SkeletonLines lines={4} label="Loading company spotlight" /> : <p className="cc-empty">No company has a traded price to weight yet.</p>}</div>
    </section>;
  }

  const { company, weighted } = slides[current];
  const day = changeOver(company.history, 1);
  const week = changeOver(company.history, 7);
  const vsOffchain = weighted && company.offchainPrice ? weighted.price / company.offchainPrice - 1 : null;

  return <section ref={frame} className="pc-card cc-section" aria-roledescription="carousel" aria-labelledby="cc-h"
    onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
    onFocus={() => setHeld(true)} onBlur={(event) => { if (!frame.current?.contains(event.relatedTarget as Node)) { setHeld(false); } }}>
    <div className="cc-head">
      <h2 id="cc-h" className="pc-h2 cc-title">Company spotlight
        <InfoTip label="What the weighted price is">
          The volume-weighted price is the average of every market quoting this company on its main price basis, each counted in proportion to what it traded in the last 24 hours (or 30 days when no market reports a day). It is the price most of the money actually changed hands at. Markets quoting a different unit, such as a contract worth a fraction of a share, are left out.
        </InfoTip>
      </h2>
      <div className="cc-controls">
        <button type="button" className="cc-btn" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause the slideshow" : "Play the slideshow"} disabled={still || count < 2}>
          {playing && !still ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" className="cc-btn" onClick={() => go(-1)} aria-label="Previous company" disabled={count < 2}><ChevronLeft size={16} /></button>
        <span className="cc-count" aria-hidden>{current + 1} / {count}</span>
        <button type="button" className="cc-btn" onClick={() => go(1)} aria-label="Next company" disabled={count < 2}><ChevronRight size={16} /></button>
      </div>
    </div>

    <div className="cc-slide" role="group" aria-roledescription="slide" aria-label={`${current + 1} of ${count}: ${company.name}`} aria-live={auto ? "off" : "polite"} key={company.slug}>
      <div className="cc-lead">
        <Link href={`/company/${company.slug}`} className="cc-id">
          <Mark name={company.name} logo={company.logo} size={48} />
          <span className="cc-id-text"><strong>{company.name}</strong><small>{company.sector ?? `${plural(company.rows.length, "market")} on ${plural(company.venues.length, "venue")}`}</small></span>
        </Link>
        <div className="cc-reading">
          <span className="cc-reading-label">Volume-weighted price</span>
          <span className="cc-reading-value">{formatPrice(weighted!.price)}</span>
          <span className="cc-reading-sub">Across {plural(weighted!.markets, "market")}, weighted by {weighted!.weight === "24h" ? "24-hour" : "30-day"} volume{vsOffchain !== null ? `, ${formatSignedPercent(vsOffchain)} vs off-chain` : ""}</span>
        </div>
        <Spark values={company.history} width={200} height={56} label={`${company.name} lead-market price, last ${company.history.length} days`} />
      </div>
      <dl className="cc-stats">
        <div><dt>Off-chain price</dt><dd>{formatPrice(company.offchainPrice)}</dd></div>
        <div><dt>Off-chain valuation</dt><dd>{compactUsd(company.offchainValuation)}</dd></div>
        <div><dt>Implied valuation</dt><dd>{compactUsd(company.impliedValuation)}{company.premium !== null && <small className={company.premium >= 0 ? "pc-up" : "pc-down"}>{formatSignedPercent(company.premium)}</small>}</dd></div>
        <div><dt>24h</dt><dd><Pct value={day} /></dd></div>
        <div><dt>7d</dt><dd><Pct value={week} /></dd></div>
        <div><dt>24h volume</dt><dd>{compactUsd(company.totals.volume24hUsd)}</dd></div>
        <div><dt>Open interest</dt><dd>{company.totals.openInterestUsd ? compactUsd(company.totals.openInterestUsd) : "—"}</dd></div>
        <div><dt>Funding</dt><dd>{fundingText(company.funding)}</dd></div>
      </dl>
    </div>

    <div className="cc-dots" role="group" aria-label="Choose a company">
      {slides.map((slide, position) => <button key={slide.company.slug} type="button" className="cc-dot" aria-pressed={position === current}
        aria-label={`Show ${slide.company.name}`} onClick={() => setIndex(position)}><span /></button>)}
    </div>
  </section>;
}
