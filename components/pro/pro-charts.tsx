"use client";

import type { DailyClose } from "@/lib/market-coverage";

/**
 * Small hand-drawn SVG charts for Pro, in the artboards' style: hairline
 * grid, labels in the right gutter, non-scaling strokes so the lines stay
 * crisp when the SVG stretches to its container.
 */

const W = 720;
const H = 216;

export type Line = { key: string; name: string; colour: string; points: DailyClose[] };

const shortDate = (at: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${at.slice(0, 10)}T00:00:00Z`));

/**
 * Several daily series rebased to 100 at their first close in the window, on
 * one shared date axis, so companies priced in different units compare.
 */
export function RebasedChart({ lines, label }: { lines: Line[]; label: string }) {
  const usable = lines.filter((line) => line.points.length >= 2);
  if (!usable.length) { return <div className="p-chart-empty">No daily closes for this window.</div>; }
  const dates = [...new Set(usable.flatMap((line) => line.points.map((point) => point.at.slice(0, 10))))].sort();
  const index = new Map(dates.map((date, position) => [date, position]));
  const rebased = usable.map((line) => {
    const base = line.points[0].close;
    return { ...line, values: line.points.map((point) => ({ x: index.get(point.at.slice(0, 10)) ?? 0, y: point.close / base * 100 })) };
  });
  const all = rebased.flatMap((line) => line.values.map((value) => value.y));
  const low = Math.min(...all, 100);
  const high = Math.max(...all, 100);
  const pad = Math.max((high - low) * 0.12, 0.5);
  const yMin = low - pad;
  const yMax = high + pad;
  const toX = (x: number) => dates.length > 1 ? x / (dates.length - 1) * W : W / 2;
  const toY = (y: number) => H - (y - yMin) / (yMax - yMin) * H;
  const ticks = [0, 1, 2, 3].map((step) => yMax - (yMax - yMin) * step / 3);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => dates[Math.round(fraction * (dates.length - 1))]);
  return <div className="p-linechart">
    <div className="p-linechart-grid" aria-hidden>
      {ticks.map((tick) => <div key={tick}><span className="p-mono">{tick.toFixed(1)}</span></div>)}
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1={0} x2={W} y1={toY(100)} y2={toY(100)} stroke="#9ca3af" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      {rebased.map((line) => (
        <polyline key={line.key} points={line.values.map((value) => `${toX(value.x).toFixed(1)},${toY(value.y).toFixed(1)}`).join(" ")}
          fill="none" stroke={line.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
    <div className="p-linechart-x p-mono" aria-hidden>{xTicks.map((date, position) => <span key={`${date}-${position}`}>{date ? shortDate(date) : ""}</span>)}</div>
  </div>;
}

/**
 * One price series, green above its opening close and red below, split at a
 * dashed baseline — the company artboard's price chart.
 */
export function SplitPriceChart({ points, label, money }: { points: DailyClose[]; label: string; money: (value: number) => string }) {
  if (points.length < 2) { return <div className="p-chart-empty">Fewer than two daily closes in this window.</div>; }
  const closes = points.map((point) => point.close);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const pad = Math.max((high - low) * 0.12, high * 0.002);
  const yMin = low - pad;
  const yMax = high + pad;
  const toX = (index: number) => index / (points.length - 1) * W;
  const toY = (value: number) => H - (value - yMin) / (yMax - yMin) * H;
  const baseY = toY(closes[0]);
  const line = closes.map((value, index) => `${toX(index).toFixed(1)},${toY(value).toFixed(1)}`).join(" ");
  const area = `${line} ${W},${baseY.toFixed(1)} 0,${baseY.toFixed(1)}`;
  const ticks = [0, 1, 2, 3].map((step) => yMax - (yMax - yMin) * step / 3);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => points[Math.round(fraction * (points.length - 1))].at);
  const id = label.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return <div className="p-linechart tall">
    <div className="p-linechart-grid" aria-hidden>
      {ticks.map((tick) => <div key={tick}><span className="p-mono">{money(tick)}</span></div>)}
    </div>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <defs>
        <clipPath id={`${id}-up`}><rect x={0} y={0} width={W} height={Math.max(baseY, 0)} /></clipPath>
        <clipPath id={`${id}-dn`}><rect x={0} y={baseY} width={W} height={Math.max(H - baseY, 0)} /></clipPath>
      </defs>
      <polygon points={area} fill="#10b981" fillOpacity={0.1} clipPath={`url(#${id}-up)`} />
      <polygon points={area} fill="#ef4444" fillOpacity={0.1} clipPath={`url(#${id}-dn)`} />
      <line x1={0} x2={W} y1={baseY} y2={baseY} stroke="#9ca3af" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <polyline points={line} fill="none" stroke="#10b981" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${id}-up)`} />
      <polyline points={line} fill="none" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${id}-dn)`} />
    </svg>
    <div className="p-linechart-x p-mono" aria-hidden>{xTicks.map((date, position) => <span key={`${date}-${position}`}>{shortDate(date)}</span>)}</div>
  </div>;
}

/** A tiny line for table rows. */
export function PSpark({ points, width = 104, height = 30, label }: { points: number[]; width?: number; height?: number; label: string }) {
  const values = points.filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2) { return <span className="p-mono p-flat" aria-hidden>—</span>; }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const line = values.map((value, index) => `${(index * width / (values.length - 1)).toFixed(1)},${(height - 3 - (value - low) / span * (height - 6)).toFixed(1)}`).join(" ");
  const colour = values[values.length - 1] >= values[0] ? "#10b981" : "#ef4444";
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="p-spark">
    <polygon points={`${line} ${width},${height} 0,${height}`} fill={colour} fillOpacity={0.08} />
    <polyline points={line} fill="none" stroke={colour} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
  </svg>;
}
