"use client";

import { CompanyMark } from "./company-mark";
import { formatSignedPercent } from "@/app/data";

/**
 * Small pieces of the Pre-IPO Markets design used on more than one page.
 * Each takes real values and renders nothing invented when one is missing.
 */

/** A company logo inside the design's round frame. */
export function Mark({ name, logo, size = 38 }: { name: string; logo: string | null; size?: 30 | 32 | 38 | 48 }) {
  return <span className={`pc-mark s${size}`}><CompanyMark name={name} logo={logo} large={size >= 48} /></span>;
}

/** "▲ 2.67%" in a tinted pill, or a dash when there is nothing to compare. */
export function ChangeBadge({ value, suffix }: { value: number | null; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) { return <span className="pc-badge flat">—{suffix ? ` ${suffix}` : ""}</span>; }
  const flat = Math.abs(value) < 0.00005;
  const tone = flat ? "flat" : value > 0 ? "up" : "down";
  const arrow = flat ? "" : value > 0 ? "▲ " : "▼ ";
  return <span className={`pc-badge ${tone}`}>{arrow}{flat ? "0.00%" : formatSignedPercent(value).replace(/^[+−]/, "")}{suffix ? ` ${suffix}` : ""}</span>;
}

/** A signed percentage coloured by direction, for table cells. */
export function Pct({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) { return <span className="pc-pct pc-flat">—</span>; }
  const flat = Math.abs(value) < 0.00005;
  if (flat) { return <span className="pc-pct pc-flat">0.00%</span>; }
  return <span className={`pc-pct ${value > 0 ? "pc-up" : "pc-down"}`}>{value > 0 ? "▲ " : "▼ "}{formatSignedPercent(value).replace(/^[+−]/, "")}</span>;
}

/**
 * A bar that grows left or right from a centre tick, for figures whose sign
 * is the point (premium to mark, funding). `max` is the largest magnitude in
 * the set, so bars compare against each other rather than against 100%.
 */
export function DivBar({ value, max, width = 64 }: { value: number; max: number; width?: number }) {
  const share = max > 0 ? Math.min(Math.abs(value) / max, 1) * 50 : 0;
  const positive = value >= 0;
  return (
    <span className="pc-divbar" style={{ width }} aria-hidden>
      <span style={{ left: `${positive ? 50 : 50 - share}%`, width: `${share}%`, background: positive ? "var(--up-bar)" : "var(--down-bar)" }} />
    </span>
  );
}

/**
 * A short price series as a line over a faint fill, coloured by whether it
 * ended above where it started. Draws a dash when there are under two points.
 */
export function Spark({ values, width = 112, height = 32, label }: { values: readonly number[]; width?: number; height?: number; label?: string }) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length < 2) { return <span className="pc-muted" aria-hidden>—</span>; }
  const low = Math.min(...usable);
  const high = Math.max(...usable);
  const span = high - low || 1;
  const pad = 3;
  const step = width / (usable.length - 1);
  const line = usable.map((value, index) => {
    const y = high === low ? height / 2 : height - pad - ((value - low) / span) * (height - pad * 2);
    return `${(index * step).toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const rising = usable[usable.length - 1] >= usable[0];
  const colour = rising ? "var(--up-bar)" : "var(--down-bar)";
  return (
    <svg className="pc-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `${rising ? "Up" : "Down"} over the period shown`}>
      <polygon points={`${line} ${width},${height} 0,${height}`} fill={colour} fillOpacity={0.1} />
      <polyline points={line} fill="none" stroke={colour} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Two letters for a venue or issuer tile. */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!parts.length) { return "?"; }
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? "")).toUpperCase();
}

/** A spot price against the off-chain share price, as "+4.2% premium" or "−12% discount" to off-chain. */
export function SpotGap({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) { return <span className="pc-prem flat">no off-chain price</span>; }
  if (Math.abs(value) < 0.0005) { return <span className="pc-prem flat">at off-chain price</span>; }
  return <span className={`pc-prem ${value > 0 ? "up" : "down"}`}>{formatSignedPercent(value)}<small>{value > 0 ? " premium to off-chain" : " discount to off-chain"}</small></span>;
}
