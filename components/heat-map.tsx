"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";
import { ExchangeMark } from "@/components/exchange-mark";
import { InfoTip } from "@/components/info-tip";
import { changeOver, formatSignedPercent } from "@/app/data";
import { compactUsd, VENUE_NAMES, type CompanyView } from "@/lib/coverage-view";
import { marketChange, marketKey, type HistoryPayload } from "@/components/pro/pro-history";

/**
 * Heat map: the covered companies as a treemap, grouped by sector, each tile
 * sized by a measure (valuation, volume) and coloured by its price move over
 * a period. Pro can also tile every market, grouped by company.
 *
 * The layout is a squarified treemap computed in pixels from the container's
 * measured width, so tile text can be sized to the tile. Shared by Lite and
 * Pro; the variant only picks the section frame and the control style.
 */

/** Hidden for now at the owner's request; set to true to show the section in Lite and Pro and the Pro sidebar link. */
export const HEAT_MAP_ENABLED = false;

type Period = 1 | 7 | 30;
type Grouping = "companies" | "markets";
type Measure = "valuation" | "volume30" | "openInterest";

type Tile = {
  key: string;
  label: string;
  sub: string;
  href: string;
  size: number;
  change: number | null;
  logo: { name: string; logo: string | null } | null;
  exchange: { provider: string; venue: string } | null;
};
type Group = { key: string; label: string; tiles: Tile[] };
type Rect = { x: number; y: number; w: number; h: number };

const PERIODS: { key: Period; label: string }[] = [{ key: 1, label: "1D" }, { key: 7, label: "7D" }, { key: 30, label: "30D" }];
/** Colour steps per period: a 3% day is as notable as a 20% month. */
const STEPS: Record<Period, [number, number, number]> = { 1: [0.01, 0.02, 0.03], 7: [0.025, 0.05, 0.1], 30: [0.05, 0.1, 0.2] };
const MEASURE_LABEL: Record<Measure, string> = { valuation: "Valuation", volume30: "30D volume", openInterest: "Open interest" };
const OTHER = "Other";
const HEADER = 22;
const GROUP_GAP = 3;

/** A company's move over `days`, from its lead market's daily closes. */
function companyChange(company: CompanyView, days: Period): number | null {
  const closes = company.series.length ? company.series.map((point) => point.close) : company.history;
  return closes.length > days ? changeOver(closes, days) : null;
}

/** Squarified treemap (Bruls, Huizing, van Wijk): rows of tiles kept as close to square as the sizes allow. */
function squarify(values: number[], rect: Rect): Rect[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  const out: Rect[] = new Array(values.length);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) { return values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 })); }
  const scale = rect.w * rect.h / total;
  const order = values.map((value, index) => ({ area: value * scale, index }));
  let { x, y, w, h } = rect;
  let row: typeof order = [];
  const worst = (items: typeof order, side: number) => {
    const sum = items.reduce((total, item) => total + item.area, 0);
    return Math.max(...items.map((item) => Math.max(side * side * item.area / (sum * sum), sum * sum / (side * side * item.area))));
  };
  const place = (items: typeof order) => {
    const sum = items.reduce((total, item) => total + item.area, 0);
    if (w >= h) {
      const width = sum / h;
      let top = y;
      for (const item of items) { const height = item.area / width; out[item.index] = { x, y: top, w: width, h: height }; top += height; }
      x += width; w -= width;
    } else {
      const height = sum / w;
      let left = x;
      for (const item of items) { const width = item.area / height; out[item.index] = { x: left, y, w: width, h: height }; left += width; }
      y += height; h -= height;
    }
  };
  let queue = order;
  while (queue.length) {
    const side = Math.min(w, h);
    const next = queue[0];
    if (!row.length || worst([...row, next], side) <= worst(row, side)) { row.push(next); queue = queue.slice(1); }
    else { place(row); row = []; }
  }
  if (row.length) { place(row); }
  return out;
}

function tone(change: number | null, period: Period): string {
  if (change === null || !Number.isFinite(change)) { return "none"; }
  const [one, two, three] = STEPS[period];
  const size = Math.abs(change);
  if (size < one / 4) { return "flat"; }
  const level = size >= three ? 3 : size >= two ? 2 : 1;
  return `${change > 0 ? "up" : "down"}-${level}`;
}

function percent(value: number) {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${(Math.abs(value) * 100).toFixed(Math.abs(value) >= 0.1 ? 0 : 1)}%`;
}

export function HeatMap({ companies, loading, variant, history = null }: {
  companies: CompanyView[];
  loading: boolean;
  variant: "lite" | "pro";
  /** Pro passes daily candles, which turns on the per-market view. */
  history?: HistoryPayload | null;
}) {
  const pro = variant === "pro";
  const [grouping, setGrouping] = useState<Grouping>("companies");
  const [measure, setMeasure] = useState<Measure>("valuation");
  const [period, setPeriod] = useState<Period>(1);
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);

  useEffect(() => {
    const node = frame.current;
    if (!node) { return; }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const byMarket = useMemo(() => new Map((history?.markets ?? []).map((market) => [marketKey(market), market])), [history]);
  const markets = pro && grouping === "markets";
  const measures: Measure[] = markets ? ["volume30", "openInterest"] : ["valuation", "volume30"];
  const activeMeasure = measures.includes(measure) ? measure : measures[0];

  // Cheap for a few dozen tiles; recomputed each render (the React Compiler memoizes it).
  const { groups, unsized } = (() => {
    const unsizedNames: string[] = [];
    let list: Group[];
    if (markets) {
      list = companies.map((company) => ({
        key: company.slug, label: company.name,
        tiles: company.rows.map((row) => {
          const size = activeMeasure === "openInterest" ? row.openInterestUsd ?? 0 : row.volume30dUsd ?? 0;
          const venue = VENUE_NAMES[row.venue] ?? row.venue;
          return {
            key: marketKey(row), label: row.label, sub: `${venue} · ${row.marketType.toUpperCase()}`, href: `/company/${company.slug}`,
            size, change: marketChange(byMarket.get(marketKey(row))?.points, period),
            logo: null, exchange: { provider: row.provider, venue },
          };
        }).filter((tile) => tile.size > 0),
      }));
    } else {
      const sectors = new Map<string, Tile[]>();
      for (const company of companies) {
        const size = activeMeasure === "valuation" ? company.offchainValuation ?? company.impliedValuation ?? 0 : company.totals.volume30dUsd;
        if (!(size > 0)) { unsizedNames.push(company.name); continue; }
        const sector = company.sector ?? OTHER;
        const value = activeMeasure === "valuation" ? `${compactUsd(size)} valuation` : `${compactUsd(size)} 30D vol`;
        sectors.set(sector, [...(sectors.get(sector) ?? []), {
          key: company.slug, label: company.name, sub: value, href: `/company/${company.slug}`,
          size, change: companyChange(company, period), logo: { name: company.name, logo: company.logo }, exchange: null,
        }]);
      }
      list = [...sectors].map(([label, tiles]) => ({ key: label, label, tiles }));
    }
    for (const group of list) { group.tiles.sort((a, b) => b.size - a.size); }
    return {
      groups: list.filter((group) => group.tiles.length)
        .sort((a, b) => (a.label === OTHER ? 1 : 0) - (b.label === OTHER ? 1 : 0) || b.tiles.reduce((s, t) => s + t.size, 0) - a.tiles.reduce((s, t) => s + t.size, 0)),
      unsized: unsizedNames,
    };
  })();

  const height = Math.round(Math.min(640, Math.max(width < 640 ? 520 : 400, width * 0.46)));
  const groupRects = squarify(groups.map((group) => group.tiles.reduce((sum, tile) => sum + tile.size, 0)), { x: 0, y: 0, w: width, h: height });
  const [one, two, three] = STEPS[period];
  const periodName = period === 1 ? "the last day" : `the last ${period} days`;
  const noHistory = markets && !history;

  const segment = (label: string, items: { key: string; label: string; on: boolean; pick: () => void }[]) => pro
    ? <div className="p-seg square" role="group" aria-label={label}>{items.map((item) => <button key={item.key} type="button" aria-pressed={item.on} onClick={item.pick}>{item.label}</button>)}</div>
    : <div className="pc-segment" role="group" aria-label={label}>{items.map((item) => <button key={item.key} type="button" className="pc-seg" aria-pressed={item.on} onClick={item.pick}>{item.label}</button>)}</div>;

  const controls = <div className="hm-controls">
    {pro && <div className="hm-control"><span className="hm-control-label">Show</span>{segment("Show", (["companies", "markets"] as const).map((key) => ({ key, label: key === "companies" ? "Companies" : "Markets", on: grouping === key, pick: () => setGrouping(key) })))}</div>}
    <div className="hm-control"><span className="hm-control-label">Size by</span>{segment("Size by", measures.map((key) => ({ key, label: MEASURE_LABEL[key], on: activeMeasure === key, pick: () => setMeasure(key) })))}</div>
    <div className="hm-control"><span className="hm-control-label">Change</span>{segment("Change period", PERIODS.map((item) => ({ key: String(item.key), label: item.label, on: period === item.key, pick: () => setPeriod(item.key) })))}</div>
    <div className="hm-legend" aria-label={`Colour scale for ${periodName}`}>
      {[-three, -two, -one, 0, one, two, three].map((step) => <span key={step} className={`hm-swatch hm-${tone(step === 0 ? 0 : step, period)}`}>{step === 0 ? "0%" : percent(step)}</span>)}
    </div>
  </div>;

  const map = <div className="hm-frame" ref={frame}>
    <div className="hm-map" style={{ height }} role="list" aria-label={`Heat map of ${markets ? "markets" : "companies"} sized by ${MEASURE_LABEL[activeMeasure].toLowerCase()}, coloured by change over ${periodName}`}>
      {loading ? <div className="hm-placeholder" aria-hidden><span /><span /><span /><span /></div>
        : !groups.length ? <p className="hm-empty">{markets ? "No market reports this measure yet." : "No company has a figure for this measure yet."}</p>
        : groups.map((group, groupIndex) => {
          const box = groupRects[groupIndex];
          const inner = { x: box.x + GROUP_GAP / 2, y: box.y + GROUP_GAP / 2, w: Math.max(0, box.w - GROUP_GAP), h: Math.max(0, box.h - GROUP_GAP) };
          const titled = inner.h > HEADER * 2.4 && inner.w > 72;
          const area = { x: inner.x, y: inner.y + (titled ? HEADER : 0), w: inner.w, h: inner.h - (titled ? HEADER : 0) };
          const rects = squarify(group.tiles.map((tile) => tile.size), area);
          return <div key={group.key} className="hm-group" role="listitem" aria-label={group.label}>
            {titled && <span className="hm-group-label" style={{ left: inner.x, top: inner.y, width: inner.w, height: HEADER }}>{group.label}</span>}
            <ul className="hm-tiles">
              {group.tiles.map((tile, index) => {
                const rect = rects[index];
                const side = Math.sqrt(rect.w * rect.h);
                const level = rect.w >= 120 && rect.h >= 92 ? "l" : rect.w >= 70 && rect.h >= 44 ? "m" : rect.w >= 40 && rect.h >= 24 ? "s" : "xs";
                const style = {
                  left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                  "--hm-name": `${Math.round(Math.min(30, Math.max(11, side / 8.5)))}px`,
                  "--hm-mark": `${Math.round(Math.min(64, Math.max(18, side / 4.2)))}px`,
                } as CSSProperties;
                const said = tile.change === null ? "no change data" : `${tile.change >= 0 ? "up" : "down"} ${formatSignedPercent(Math.abs(tile.change)).replace(/^[+−]/, "")} over ${periodName}`;
                return <li key={tile.key} style={style} className="hm-cell">
                  <Link href={tile.href} className={`hm-tile hm-${tone(tile.change, period)} hm-${level}`} aria-label={`${tile.label}, ${tile.sub}, ${said}`} title={`${tile.label} · ${tile.sub} · ${tile.change === null ? "—" : formatSignedPercent(tile.change)}`}>
                    {level === "l" && (tile.logo ? <span className="hm-mark"><CompanyMark name={tile.logo.name} logo={tile.logo.logo} /></span>
                      : tile.exchange && <span className="hm-mark hm-mark-x"><ExchangeMark provider={tile.exchange.provider} venue={tile.exchange.venue} size={28} /></span>)}
                    {level !== "xs" && level !== "s" && <span className="hm-name">{tile.label}</span>}
                    {level !== "xs" && <span className="hm-change">{tile.change === null ? "—" : formatSignedPercent(tile.change)}</span>}
                    {level === "l" && <span className="hm-sub">{tile.sub}</span>}
                  </Link>
                </li>;
              })}
            </ul>
          </div>;
        })}
    </div>
  </div>;

  const note = markets
    ? <>Each tile is one market, grouped by company. Size is its {MEASURE_LABEL[activeMeasure].toLowerCase()}; colour is how its own price moved over {periodName}: green up, red down, grey flat.</>
    : <>Each tile is one company, grouped by sector. Size is its {MEASURE_LABEL[activeMeasure].toLowerCase()}; colour is how its lead market&apos;s price moved over {periodName}: green up, red down, grey flat.</>;
  const foot = <>
    <span>{noHistory ? "Daily candles are still loading; market moves show as — until they arrive." : "Hatched tiles have no daily close that far back. Hover or focus a tile for its exact figures; select it to open the company."}</span>
    {unsized.length > 0 && <span>Not sized (no {MEASURE_LABEL[activeMeasure].toLowerCase()}): {unsized.join(", ")}</span>}
  </>;

  const tip = <InfoTip label="How to read the heat map">
    A treemap: the whole rectangle is the covered market and every tile is a share of it, so big tiles are big companies (or busy markets) and small ones are small. Tiles are grouped by {markets ? "company" : "sector"}. Colour shows direction and size of the move: the deeper the green or red, the bigger the move, using steps of {percent(one)}, {percent(two)} and {percent(three)} for this period. Grey means it barely moved; hatched means there is no close to compare against.
  </InfoTip>;

  if (pro) {
    return <section className="p-panel hm-section" id="heat-map" aria-labelledby="hm-h">
      <div className="p-panel-head">
        <div className="p-panel-title">
          <h2 id="hm-h">Heat map</h2>
          <span className="hm-tip">{tip}</span>
          <p className="mk-note">{note}</p>
        </div>
      </div>
      {controls}
      <div className="p-pad">{map}</div>
      <div className="p-panel-foot">{foot}</div>
    </section>;
  }
  return <section className="pc-card hm-section" id="heat-map" aria-labelledby="hm-h">
    <div className="hm-head">
      <div>
        <div className="hm-title"><h2 id="hm-h" className="pc-h2">Heat map</h2>{tip}</div>
        <p className="mk-note">{note}</p>
      </div>
    </div>
    {controls}
    <div className="hm-body">{map}</div>
    <div className="pc-table-foot">{foot}</div>
  </section>;
}
