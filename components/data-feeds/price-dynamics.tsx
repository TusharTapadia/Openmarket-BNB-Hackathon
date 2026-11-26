"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FeedHistory, HistoryRow, Interval } from "@/lib/data-feeds";
import { SkeletonChart, useCrosshair } from "@/components/skeleton";
import { clock, clockSeconds, dayOnly, dayTime, money } from "./shared";

/**
 * Price dynamics: the aggregate and one line per source, at the chosen
 * interval. The aggregate line is our own sampling of the derived price; a
 * source line is the venue's published candles where it has them, else our
 * samples of that source.
 */

export const INTERVAL_OPTIONS: Interval[] = ["1s", "1m", "5m", "1h", "24h"];
const WINDOW_TEXT: Record<Interval, string> = { "1s": "last 15 minutes", "1m": "last 6 hours", "5m": "last 24 hours", "1h": "last 7 days", "24h": "last 180 days" };

/** Sources further than this from the aggregate start hidden; the menu turns them on. */
const DEFAULT_BAND = 0.03;

const colour = (index: number) => `var(--series-${(index % 7) + 2})`;

function tickFormat(interval: Interval) {
  return (value: number) => {
    const date = new Date(value);
    if (interval === "24h") { return dayOnly.format(date); }
    if (interval === "1h") { return dayTime.format(date); }
    return clock.format(date);
  };
}

function SourcesMenu({ lines, visible, onToggle }: { lines: FeedHistory["lines"]; visible: Set<string>; onToggle: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const sources = lines.filter((line) => line.key !== "agg");
  const shown = sources.filter((line) => visible.has(line.key)).length;

  useEffect(() => {
    if (!open) { return; }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); button.current?.focus(); }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) { setOpen(false); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    // Focus the first option so the keyboard lands inside the menu.
    menu.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open]);

  return <div className="df-menu">
    <button ref={button} type="button" className="df-menu-button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      Sources ({shown} of {sources.length})<ChevronDown size={14} aria-hidden />
    </button>
    {open && <div ref={menu} id={id} className="df-menu-panel" role="group" aria-label="Lines to show"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== button.current) { setOpen(false); } }}>
      {lines.map((line) => {
        const index = sources.indexOf(line);
        return <label key={line.key} className="df-menu-item">
          <input type="checkbox" checked={visible.has(line.key)} onChange={() => onToggle(line.key)} />
          <i className="df-swatch" style={{ background: line.key === "agg" ? "var(--series-1)" : colour(index) }} aria-hidden />
          <span className="df-menu-text">
            <span>{line.label}</span>
            <small>{line.key === "agg" ? "our samples" : line.origin === "venue" ? "venue candles" : "our samples"}, {line.points} points</small>
          </span>
        </label>;
      })}
    </div>}
  </div>;
}

const GAP_BUCKETS = 4;
const GAP_MIN_MS = 5 * 60_000;

/** Rows re-keyed so each unbroken run of a line has its own key ("s3", "s3~1", …). */
function splitAtGaps(history: FeedHistory | null): { rows: HistoryRow[]; segments: Map<string, { key: string; points: number }[]> } {
  const segments = new Map<string, { key: string; points: number }[]>();
  if (!history) { return { rows: [], segments }; }
  const gap = Math.max(GAP_BUCKETS * history.bucketMs, GAP_MIN_MS);
  const last = new Map<string, number>();
  const rows = history.rows.map((row) => {
    const next = { t: row.t } as HistoryRow;
    for (const line of history.lines) {
      const value = row[line.key];
      if (typeof value !== "number") { continue; }
      const runs = segments.get(line.key) ?? [];
      const previous = last.get(line.key);
      if (!runs.length || (previous !== undefined && row.t - previous > gap)) { runs.push({ key: runs.length ? `${line.key}~${runs.length}` : line.key, points: 0 }); }
      const run = runs[runs.length - 1];
      run.points += 1;
      segments.set(line.key, runs);
      last.set(line.key, row.t);
      next[run.key] = value;
    }
    return next;
  });
  return { rows, segments };
}

export function PriceDynamics({ history, interval, onInterval, loading, error, headingId }: {
  history: FeedHistory | null;
  interval: Interval;
  onInterval: (interval: Interval) => void;
  loading: boolean;
  error: string | null;
  headingId: string;
}) {
  const chartSkeleton = useCrosshair(loading);
  const lines = useMemo(() => history?.lines ?? [], [history]);
  const sources = lines.filter((line) => line.key !== "agg");
  // By default: the aggregate and the four heaviest sources (the API lists them by weight)
  // that sit within DEFAULT_BAND of it, so one far-off source does not flatten the rest.
  const defaults = useMemo(() => new Set(["agg", ...lines.filter((line) => line.key !== "agg" && Math.abs(line.deviation ?? 0) <= DEFAULT_BAND).slice(0, 4).map((line) => line.key)]), [lines]);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const visible = useMemo(() => new Set(lines.filter((line) => overrides.get(line.key) ?? defaults.has(line.key)).map((line) => line.key)), [lines, overrides, defaults]);
  function toggle(key: string) {
    setOverrides((current) => new Map(current).set(key, !visible.has(key)));
  }

  const drawn = lines.filter((line) => visible.has(line.key) && line.points > 0);
  // A line is split where its points are further apart than GAP_BUCKETS buckets
  // (or GAP_MIN_MS), so a stretch with no readings is left blank, not bridged.
  const { rows, segments } = useMemo(() => splitAtGaps(history), [history]);
  const values = rows.flatMap((row) => drawn.map((line) => row[line.key]).filter((value): value is number => typeof value === "number"));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = (max - min) * 0.08 || max * 0.002 || 1;
  const aggregate = lines.find((line) => line.key === "agg");
  const collecting = !!history && (aggregate?.points ?? 0) < 2;
  const anything = drawn.some((line) => line.points >= 2);
  const since = history?.firstSampleAt ? clock.format(new Date(history.firstSampleAt)) : null;

  return <section className="df-card" aria-labelledby={headingId}>
    <header className="df-card-head df-dyn-head">
      <h2 id={headingId}>Price dynamics</h2>
      <div className="df-dyn-tools">
        <div className="df-seg" role="group" aria-label="Interval">
          {INTERVAL_OPTIONS.map((option) => <button key={option} type="button" aria-pressed={option === interval} onClick={() => onInterval(option)}>{option}</button>)}
        </div>
        {lines.length > 0 && <SourcesMenu lines={lines} visible={visible} onToggle={toggle} />}
      </div>
    </header>

    {drawn.length > 0 && <ul className="df-legend" aria-label="Lines shown">
      {drawn.map((line) => <li key={line.key}>
        <i className={`df-swatch ${line.key === "agg" ? "df-swatch-agg" : ""}`} style={{ background: line.key === "agg" ? "var(--series-1)" : colour(sources.indexOf(line)) }} aria-hidden />
        <span title={line.label}>{line.label}</span>
      </li>)}
    </ul>}

    {loading ? <div ref={chartSkeleton}><SkeletonChart height={320} label="Loading price history" /></div>
      : error ? <p className="df-error" role="alert">Price history could not be loaded. {error}</p>
      : !anything ? <div className="df-chart-empty">
        <strong>Collecting</strong>
        <p>{history?.sampleCount ?? 0} sample{history?.sampleCount === 1 ? "" : "s"}{since ? ` since ${since}` : ""}. The aggregate is recomputed about once a minute and recorded each time this feed is read; the line draws once there are two points in the {WINDOW_TEXT[interval]}.</p>
      </div>
      : <div className="df-chart" role="img" aria-label={`${drawn.map((line) => line.label).join(", ")} over the ${WINDOW_TEXT[interval]}, between ${money(min)} and ${money(max)}`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 800, height: 320 }}>
          <LineChart data={rows} margin={{ top: 8, right: 4, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tickFormat(interval)}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--color-rule-2)" }} minTickGap={48} />
            <YAxis orientation="right" domain={[min - pad, max + pad]} tickFormatter={(value: number) => money(value)} tickCount={6}
              tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={76} />
            <Tooltip
              contentStyle={{ borderRadius: 6, border: "1px solid var(--color-rule-2)", background: "var(--color-paper-2)", color: "var(--color-ink)", fontSize: 12 }}
              labelFormatter={(value) => interval === "1h" || interval === "24h" ? dayTime.format(new Date(Number(value))) : clockSeconds.format(new Date(Number(value)))}
              formatter={(value, name) => [money(Number(value)), lines.find((line) => line.key === name)?.label ?? String(name)]}
              itemSorter={(item) => -Number(item.value)} />
            {[...drawn.filter((line) => line.key !== "agg"), ...drawn.filter((line) => line.key === "agg")].flatMap((line) => (segments.get(line.key) ?? []).map((segment) => {
              const agg = line.key === "agg";
              return <Line key={segment.key} dataKey={segment.key} name={line.key} type="linear" stroke={agg ? "var(--series-1)" : colour(sources.indexOf(line))}
                strokeWidth={agg ? 2.5 : 1.5} dot={segment.points < 3 ? { r: agg ? 3.5 : 2.5 } : false} connectNulls isAnimationActive={false} />;
            }))}
          </LineChart>
        </ResponsiveContainer>
      </div>}

    {history && anything && <p className="df-foot">
      {collecting ? `The aggregate line is still collecting: ${history.sampleCount} sample${history.sampleCount === 1 ? "" : "s"}${since ? ` since ${since}` : ""}. ` : ""}
      Aggregate from our own samples of the derived price, recorded when it is recomputed (about once a minute). Source lines use the venue&apos;s own history where it publishes one (Hyperliquid candles, the Atlas oracle&apos;s series), on the same per-share basis; other sources are our samples, and a gap with no readings is left blank.
    </p>}
  </section>;
}
