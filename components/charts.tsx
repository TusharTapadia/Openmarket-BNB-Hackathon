"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/app/data";

/**
 * A price over time, drawn as one line.
 *
 * Coloured by direction over the window shown -- green if it closed above
 * where it opened, red if below -- with the opening price as a dashed
 * baseline, so the colour and the line agree about what happened.
 */
export function PriceChart({ points, label = "Price" }: { points: { at: string; price: number }[]; label?: string }) {
  const gradientId = useId().replace(/:/g, "");
  const data = points.map((point) => ({ ...point, time: Date.parse(point.at.length === 10 ? `${point.at}T00:00:00Z` : point.at) }));
  const first = data[0]?.price ?? 0;
  const last = data[data.length - 1]?.price ?? 0;
  const colour = last >= first ? "var(--up)" : "var(--down)";
  // Padded to the data's own range rather than zero: these prices move a few
  // percent, and a zero baseline would flatten every move into a straight line.
  const prices = data.map((point) => point.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const pad = Math.max((high - low) * 0.12, high * 0.002);
  const money = (value: number) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <div className="valuation-chart" role="img" aria-label={`${label} over time`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 280 }}>
      <AreaChart data={data} margin={{ top: 12, right: 0, left: 4, bottom: 4 }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colour} stopOpacity={0.14} /><stop offset="100%" stopColor={colour} stopOpacity={0.01} /></linearGradient></defs>
        <CartesianGrid stroke="var(--color-rule)" vertical={false} />
        <XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value))} tickLine={false} axisLine={false} minTickGap={48} tickMargin={12} tick={{ fill: "var(--color-muted)", fontSize: 12 }} />
        <YAxis orientation="right" domain={[low - pad, high + pad]} tickFormatter={money} tickLine={false} axisLine={false} width={76} tickMargin={8} tick={{ fill: "var(--color-muted)", fontSize: 12 }} />
        <ReferenceLine y={first} stroke="var(--color-rule-2)" strokeDasharray="3 4" />
        <Tooltip cursor={{ stroke: "var(--color-rule-2)", strokeDasharray: "4 4" }} labelFormatter={(value) => formatDate(new Date(Number(value)).toISOString())} formatter={(value) => [money(Number(value)), label]} contentStyle={{ borderRadius: 10, border: "1px solid var(--color-rule-2)", background: "var(--color-paper-2)", color: "var(--color-ink)", fontSize: 13 }} />
        <Area type="monotone" dataKey="price" stroke={colour} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
