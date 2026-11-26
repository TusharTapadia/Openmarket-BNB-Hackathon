"use client";

import { Area, AreaChart, Brush, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type PieLabelRenderProps } from "recharts";
import type { StackRow } from "./pro-history";

/**
 * Recharts pieces for the Pro home: a stacked area with a range brush, a
 * multi-line chart, and a donut with leader-line labels. All size to their
 * container, so they never push the page wider than the screen.
 */

export type Series = { key: string; name: string; colour: string; width?: number; dashed?: boolean };

const shortDate = (at: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${at}T00:00:00Z`));
const longDate = (at: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${at}T00:00:00Z`));
const AXIS = { fill: "var(--color-muted)", fontSize: 11 };
const TOOLTIP = { borderRadius: 6, border: "1px solid var(--color-rule-2)", background: "var(--color-paper-2)", color: "var(--color-ink)", fontSize: 12, padding: "6px 10px" };

export function StackedArea({ rows, series, format, height = 320 }: { rows: StackRow[]; series: Series[]; format: (value: number) => string; height?: number }) {
  // The axis is set from the stacked totals: left to recharts, the brush's
  // own stacked mini-chart is counted into the main axis and inflates it.
  const top = rows.reduce((most, row) => Math.max(most, series.reduce((sum, item) => sum + (Number((row as Record<string, unknown>)[item.key]) || 0), 0)), 0);
  return <div className="p-rc" style={{ height }}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 800, height }}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-rule)" vertical={false} />
        <XAxis dataKey="at" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tickFormatter={format} tick={AXIS} tickLine={false} axisLine={false} width={64} domain={[0, top > 0 ? top * 1.08 : "auto"]} allowDataOverflow={top > 0} />
        <Tooltip contentStyle={TOOLTIP} labelFormatter={(value) => longDate(String(value))} formatter={(value, name) => [format(Number(value)), series.find((item) => item.key === name)?.name ?? String(name)]} />
        {series.map((item) => <Area key={item.key} type="monotone" dataKey={item.key} stackId="1" stroke={item.colour} fill={item.colour} fillOpacity={0.75} strokeWidth={1} isAnimationActive={false} />)}
        <Brush dataKey="at" height={34} stroke="var(--color-rule-2)" travellerWidth={8} tickFormatter={shortDate} fill="var(--color-paper-3)">
          <AreaChart data={rows}>
            {series.map((item) => <Area key={item.key} type="monotone" dataKey={item.key} stackId="1" stroke="none" fill={item.colour} fillOpacity={0.5} isAnimationActive={false} />)}
          </AreaChart>
        </Brush>
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}

export function MultiLine({ rows, series, format, height = 260, reference }: { rows: StackRow[]; series: Series[]; format: (value: number) => string; height?: number; reference?: number }) {
  return <div className="p-rc" style={{ height }}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height }}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--color-rule)" vertical={false} />
        <XAxis dataKey="at" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis tickFormatter={format} tick={AXIS} tickLine={false} axisLine={false} width={52} domain={["auto", "auto"]} />
        <Tooltip contentStyle={TOOLTIP} labelFormatter={(value) => longDate(String(value))} formatter={(value, name) => [format(Number(value)), series.find((item) => item.key === name)?.name ?? String(name)]} />
        {reference !== undefined && <ReferenceLine y={reference} stroke="var(--color-rule-2)" strokeDasharray="3 4" />}
        {series.map((item) => <Line key={item.key} type="monotone" dataKey={item.key} stroke={item.colour} strokeWidth={item.width ?? 2} strokeDasharray={item.dashed ? "4 3" : undefined} dot={false} connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

/** Donut of shares, labelled outside with leader lines ("Hyperliquid $6.0B"). Small slices are labelled in the legend only. */
export function ShareDonut({ slices, format, height = 300 }: { slices: { name: string; value: number; colour: string }[]; format: (value: number) => string; height?: number }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const label = (props: PieLabelRenderProps) => {
    const value = Number(props.value);
    if (!total || value / total < 0.04) { return null; }
    const x = Number(props.x);
    const anchor = x > Number(props.cx) ? "start" : "end";
    return <text x={x} y={Number(props.y)} textAnchor={anchor} dominantBaseline="central" fontSize={11.5} fill="var(--color-ink-2)">
      <tspan fontWeight={600}>{String(props.name)}</tspan><tspan dx={4} fill="var(--color-muted)">{format(value)}</tspan>
    </text>;
  };
  return <div className="p-rc" style={{ height }}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 420, height }}>
      <PieChart margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="68%" paddingAngle={1} label={label} labelLine={{ stroke: "var(--color-rule-2)" }} isAnimationActive={false}>
          {slices.map((slice) => <Cell key={slice.name} fill={slice.colour} stroke="var(--color-paper-2)" />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} formatter={(value, name) => [`${format(Number(value))} · ${total ? (Number(value) / total * 100).toFixed(1) : "0"}%`, String(name)]} />
      </PieChart>
    </ResponsiveContainer>
  </div>;
}
