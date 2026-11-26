"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCrosshair as useVendoredCrosshair } from "@/vendor/crosshair-skeleton/react.js";

/**
 * Static loading placeholders: grey rounded blocks in the shape of the content
 * they stand in for, with a slow opacity pulse (off under reduced motion).
 * Each is `aria-busy` with a visually hidden "Loading" label, so a screen
 * reader hears one word rather than a spinner's silence.
 *
 * The crosshair effect (vendor/crosshair-skeleton) is reserved for one primary
 * slow block per page; everything else uses these.
 */

/**
 * Crosshair skeleton on the element the returned ref is attached to, while
 * `loading`. The element must render its real layout with placeholder content.
 */
export function useCrosshair(loading: boolean): (element: HTMLElement | null) => void {
  return useVendoredCrosshair(loading, { cursors: 1, labels: false, readout: false }) as (element: HTMLElement | null) => void;
}

export function Skeleton({ width = "100%", height = 12, radius = 6, style }: { width?: number | string; height?: number | string; radius?: number; style?: CSSProperties }) {
  return <span className="sk-block" style={{ width, height, borderRadius: radius, ...style }} />;
}

function Busy({ label = "Loading", className = "", children, style }: { label?: string; className?: string; children: ReactNode; style?: CSSProperties }) {
  return <div className={`sk ${className}`} role="status" aria-busy="true" style={style}>
    <span className="sk-sr">{label}</span>
    <div aria-hidden>{children}</div>
  </div>;
}

/** A few lines of text, the last one shorter. */
export function SkeletonLines({ lines = 3, label, gap = 8, height = 12 }: { lines?: number; label?: string; gap?: number; height?: number }) {
  return <Busy label={label} className="sk-lines" style={{ gap }}>
    {Array.from({ length: lines }, (_, index) => <Skeleton key={index} height={height} width={index === lines - 1 && lines > 1 ? "62%" : "100%"} />)}
  </Busy>;
}

/** A list of rows: a round mark, two lines, and a figure on the right. */
export function SkeletonList({ rows = 4, label, mark = 28 }: { rows?: number; label?: string; mark?: number }) {
  return <Busy label={label} className="sk-list">
    {Array.from({ length: rows }, (_, index) => <div className="sk-list-row" key={index}>
      <Skeleton width={mark} height={mark} radius={9999} />
      <span className="sk-col"><Skeleton width="55%" height={11} /><Skeleton width="35%" height={9} /></span>
      <Skeleton width={56} height={12} />
    </div>)}
  </Busy>;
}

/** A table body's worth of rows and columns, first column wider. */
export function SkeletonTable({ rows = 6, cols = 6, label, rowHeight = 52 }: { rows?: number; cols?: number; label?: string; rowHeight?: number }) {
  return <Busy label={label} className="sk-table">
    {Array.from({ length: rows }, (_, row) => <div className="sk-table-row" key={row} style={{ height: rowHeight, gridTemplateColumns: `minmax(0, 2.2fr) repeat(${Math.max(cols - 1, 1)}, minmax(0, 1fr))` }}>
      <span className="sk-first"><Skeleton width={28} height={28} radius={9999} /><span className="sk-col"><Skeleton width="60%" height={11} /><Skeleton width="38%" height={9} /></span></span>
      {Array.from({ length: Math.max(cols - 1, 1) }, (_, col) => <Skeleton key={col} width={`${60 + ((row + col) % 3) * 12}%`} height={11} style={{ justifySelf: "end" }} />)}
    </div>)}
  </Busy>;
}

/** A chart area: faint grid lines and a block where the plot goes. */
export function SkeletonChart({ height = 260, label }: { height?: number; label?: string }) {
  return <Busy label={label} className="sk-chart" style={{ height }}>
    <div className="sk-chart-grid">{[0, 1, 2, 3].map((line) => <span key={line} />)}</div>
    <Skeleton height="58%" radius={8} style={{ position: "absolute", left: 0, right: 56, bottom: 22, opacity: 0.55 }} />
    <div className="sk-chart-axis">{[0, 1, 2, 3, 4].map((tick) => <Skeleton key={tick} width={36} height={9} />)}</div>
  </Busy>;
}

/** Placeholder for a figure shown inline in text. */
export function SkeletonInline({ width = 64, height = 12 }: { width?: number | string; height?: number }) {
  return <span className="sk-inline" role="status" aria-busy="true"><span className="sk-sr">Loading</span><Skeleton width={width} height={height} /></span>;
}
