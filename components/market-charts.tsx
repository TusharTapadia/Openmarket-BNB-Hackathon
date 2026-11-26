"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/app/data";
import type { CompanyPoint } from "@/lib/market-series";

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
const FULL_LABEL = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A metric the market chart can draw, and how to read it. */
export type Metric = "valuation" | "volume" | "index";

const METRICS: Record<Metric, { name: string; colour: string; format: (value: number) => string }> = {
  valuation: { name: "implied valuation", colour: "#1f3fd1", format: (value) => formatMoney(value) },
  volume: { name: "volume", colour: "#0f766e", format: (value) => formatMoney(value) },
  index: { name: "index", colour: "#7c3aed", format: (value) => value.toFixed(2) },
};

/**
 * One company over time.
 *
 * A single series at a time: valuation is in billions and volume in
 * thousands, and drawing them together leaves the smaller one flat along the
 * floor whatever it did.
 */
export function CompanyChart({ points, metric, height = 400, label }: {
  points: readonly CompanyPoint[];
  metric: Metric;
  height?: number;
  label: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const { colour, name, format } = METRICS[metric];
  const data = points.flatMap((point) => {
    const value = metric === "valuation" ? point.valuation : metric === "volume" ? point.volume : point.index;
    return value === null ? [] : [{ ...point, value, time: Date.parse(`${point.at}T00:00:00Z`) }];
  });

  if (data.length < 2) {
    return <p className="chart-empty">Not enough recorded history for {label || "this company"} yet. The hourly ingest adds a point an hour.</p>;
  }

  return (
    // A concrete height, always. ResponsiveContainer measures its parent, and
    // a parent sized by `flex: 1` only resolves once every ancestor's height
    // does -- when that fails it measures zero and the chart vanishes.
    <div className="market-chart" style={{ height }} role="img" aria-label={`${label} ${name} over ${data.length} days`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 760, height }}>
        <AreaChart data={data} margin={{ top: 12, right: 0, left: 4, bottom: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.18} />
              <stop offset="100%" stopColor={colour} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]}
            tickFormatter={(value) => DAY_LABEL.format(new Date(value))}
            tickLine={false} axisLine={false} minTickGap={44} tickMargin={12}
            tick={{ fill: "var(--faint)", fontSize: 12, fontWeight: 500 }}
          />
          <YAxis
            orientation="right" tickFormatter={format} tickLine={false} axisLine={false}
            width={64} tickMargin={8} domain={["auto", "auto"]}
            tick={{ fill: "var(--faint)", fontSize: 12, fontWeight: 500 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--faint)", strokeDasharray: "4 4" }}
            labelFormatter={(value) => FULL_LABEL.format(new Date(Number(value)))}
            formatter={(value) => [format(Number(value)), `${label} ${name}`]}
            contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontWeight: 500 }}
          />
          <Area
            type="monotone" dataKey="value" stroke={colour} strokeWidth={2}
            fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4 }} isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
