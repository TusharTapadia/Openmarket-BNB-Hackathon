"use client";

import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate } from "@/app/data";
import { band, type Band, type FearGreedPoint } from "@/lib/fear-greed";

/** One colour per band, used by the gauge, the chart and the pills alike. */
export const BAND_COLOUR: Record<Band, string> = {
  "Extreme fear": "var(--fg-band-1)",
  Fear: "var(--fg-band-2)",
  Neutral: "var(--fg-band-3)",
  Greed: "var(--fg-band-4)",
  "Extreme greed": "var(--fg-band-5)",
};

const BANDS: { from: number; to: number; label: Band }[] = [
  { from: 0, to: 20, label: "Extreme fear" },
  { from: 20, to: 40, label: "Fear" },
  { from: 40, to: 60, label: "Neutral" },
  { from: 60, to: 80, label: "Greed" },
  { from: 80, to: 100, label: "Extreme greed" },
];

/**
 * The reading as a half-dial.
 *
 * Drawn rather than charted: it is one number on a fixed 0-100 scale, and the
 * bands are the point of it -- where the needle sits against them says more
 * than the number does.
 */
export function FearGreedGauge({ score }: { score: number }) {
  const value = Math.max(0, Math.min(100, score));
  const current = band(value);
  // A 180-degree arc, swept left to right. r and the stroke set the dial's
  // thickness; the viewBox leaves room for the cap at either end.
  const r = 78;
  const circumference = Math.PI * r;
  const point = (fraction: number) => {
    const angle = Math.PI * (1 - fraction);
    return { x: 100 + r * Math.cos(angle), y: 96 - r * Math.sin(angle) };
  };
  const needle = point(value / 100);

  return (
    <div className="fg-gauge">
      <svg viewBox="0 0 200 116" role="img" aria-label={`${value} out of 100, ${current}`}>
        {BANDS.map((slice) => {
          const start = slice.from / 100;
          const length = ((slice.to - slice.from) / 100) * circumference;
          return (
            <circle
              key={slice.label}
              cx="100" cy="96" r={r}
              fill="none"
              stroke={BAND_COLOUR[slice.label]}
              strokeWidth="13"
              strokeLinecap="butt"
              // Rotated so the arc starts at the left of the dial, then offset
              // to this band's slice of it.
              transform="rotate(180 100 96)"
              strokeDasharray={`${length} ${circumference * 2}`}
              strokeDashoffset={-start * circumference}
            />
          );
        })}
        <circle cx={needle.x} cy={needle.y} r="7.5" fill="var(--color-paper-2)" stroke={BAND_COLOUR[current]} strokeWidth="3.5" />
      </svg>
      <div className="fg-gauge-value">
        <div className="fg-score tabular" style={{ color: BAND_COLOUR[current] }}>{value}</div>
        <div className="fg-band">{current}</div>
      </div>
    </div>
  );
}

/** A score as a coloured pill, for the historical rows. */
export function BandPill({ score }: { score: number | null }) {
  if (score === null) { return <span className="fg-pill muted">—</span>; }
  const current = band(score);
  return (
    <span className="fg-pill" style={{ color: BAND_COLOUR[current], borderColor: `color-mix(in oklab, ${BAND_COLOUR[current]} 27%, transparent)`, background: `color-mix(in oklab, ${BAND_COLOUR[current]} 8%, transparent)` }}>
      {current} · <span className="tabular">{score}</span>
    </span>
  );
}

/**
 * The recorded readings over time, against the bands they sit in.
 *
 * The bands are drawn as the background rather than described in a legend: the
 * question this chart answers is "was the market frightened then", and a line
 * at 38 means nothing without the fear band behind it.
 */
export function FearGreedChart({ points, height = 320 }: { points: readonly FearGreedPoint[]; height?: number }) {
  const data = points.map((point) => ({ ...point, time: Date.parse(point.at) }));
  return (
    <div className="fg-chart" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height }}>
        <LineChart data={data} margin={{ top: 8, right: 2, left: 8, bottom: 8 }}>
          {/* Tinted faintly and labelled inside the plot. The scale is fixed at
              0-100 because that is what the reading means, so whichever bands
              the data does not reach are drawn empty -- at any strength that
              reads as a block of colour rather than as context, and the band
              the line is actually in stops being the thing you notice. */}
          {BANDS.map((slice) => (
            <ReferenceArea
              key={slice.label}
              y1={slice.from} y2={slice.to}
              fill={BAND_COLOUR[slice.label]} fillOpacity={0.05}
              stroke="none" ifOverflow="extendDomain"
              label={{
                value: slice.label,
                position: "insideLeft",
                fill: BAND_COLOUR[slice.label],
                fontSize: 10,
                opacity: 0.75,
                offset: 8,
              }}
            />
          ))}
          <CartesianGrid stroke="var(--color-rule)" vertical={false} strokeDasharray="3 4" />
          <XAxis
            dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]}
            tickFormatter={(value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value))}
            tickLine={false} axisLine={false} minTickGap={56} tickMargin={14} tick={{ fill: "var(--color-muted)", fontSize: 12 }}
          />
          <YAxis
            orientation="right" domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]}
            tickLine={false} axisLine={false} width={42} tickMargin={8} tick={{ fill: "var(--color-muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-rule-2)", strokeDasharray: "4 4" }}
            labelFormatter={(value) => formatDate(new Date(Number(value)).toISOString())}
            formatter={(value) => [`${Number(value)} · ${band(Number(value))}`, "Reading"]}
            contentStyle={{ borderRadius: 3, border: "1px solid var(--color-rule-2)", background: "var(--color-paper-2)", color: "var(--color-ink)", fontSize: 13 }}
          />
          <Line type="monotone" dataKey="score" stroke="var(--color-ink-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
