"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import { compactUsd, marketPrice, plural, spotPremium, TYPE_INFO, type AssetType, type CompanyView } from "@/lib/coverage-view";
import { DataState } from "@/components/data-state";
import { MarketSummary } from "@/components/market-summary";
import { HEAT_MAP_ENABLED, HeatMap } from "@/components/heat-map";
import { AssetTypeTip, IST_TIME, PChg, PEmpty, PFund, PHead, PPremium, seriesChange, share, TypeTag, useProData, venueName, type FlatMarket } from "./pro-kit";
import { historyIndex, marketChange, marketKey, rollingVolatility, stackedSeries, useHistory, valuationIndex, type StackMetric } from "./pro-history";
import { MultiLine, ShareDonut, StackedArea, type Series } from "./pro-home-charts";
import { Logo, ProShell } from "./pro-shell";
import { NewsPills } from "./news-pills";
import { Flash } from "@/components/flash";
import { CompanyFilter } from "./company-filter";
import { SkeletonChart, SkeletonTable, useCrosshair } from "@/components/skeleton";

/** Figure 1's real frame with placeholder content, for the crosshair skeleton to measure. */
function FigurePlaceholder() {
  return <div className="p-figure-ph">
    <div className="p-row-between"><span className="p-mono p-chart-total">$—</span><span className="p-legend">{["—", "—", "—", "—"].map((item, index) => <span key={index}><i style={{ background: "var(--color-rule)" }} />{item}</span>)}</span></div>
    <div className="p-figure-ph-plot"><span /><span /><span /><span /></div>
    <div className="p-figure-ph-brush" />
  </div>;
}
import { ExchangeMark, VenueLogo } from "@/components/exchange-mark";

/**
 * Pro home: summary cards, a news row, then chart-led sections — a stacked
 * value/volume chart, a league table beside a share donut, an index and a
 * volatility chart side by side, and every market in one table
 * that fits its card at any width.
 */

const COLOURS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];
type League = "venue" | "provider" | "company" | "type";
type SortKey = "price" | "premium" | "volume24hUsd" | "openInterestUsd" | "fundingRateAnnualized" | "chg1" | "chg30";
const MIN_VOLUME = [0, 10_000, 100_000, 1_000_000, 10_000_000];
const VOL_WINDOW = 14;

const pctAxis = (value: number) => `${Math.round(value * 100)}%`;

function download(name: string, head: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => value === null ? "" : /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const url = URL.createObjectURL(new Blob([[head, ...rows].map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** What a company's row in All markets shows, summed or weighted from the sources the filters keep. */
type Aggregate = {
  price: number | null;
  /** Where `price` comes from, in a few words. */
  basis: string;
  /** Whether `price` is a price for one share, so it compares with the off-chain price. */
  perShare: boolean;
  volume: number;
  openInterest: number;
  funding: number | null;
};

function vwap(rows: FlatMarket[]): number | null {
  for (const pick of [(row: FlatMarket) => row.volume24hUsd, (row: FlatMarket) => row.volume30dUsd]) {
    const weighted = rows.flatMap((row) => row.price && (pick(row) ?? 0) > 0 ? [{ price: row.price, weight: pick(row)! }] : []);
    const total = weighted.reduce((sum, row) => sum + row.weight, 0);
    if (total > 0) { return weighted.reduce((sum, row) => sum + row.price * row.weight, 0) / total; }
  }
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) { return null; }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * One company's figures across its sources. The price is for one share where
 * the data allows it: the share price the confirmed-basis markets imply, else
 * the volume-weighted spot price, else the issuers' median token price. Only
 * when none exists does it fall back to the volume-weighted venue quote, which
 * for most perps is a valuation divided by notional shares and is labelled so.
 */
function aggregate(company: CompanyView, rows: FlatMarket[], type: AssetType | "all"): Aggregate {
  const volume = rows.reduce((sum, row) => sum + (row.volume24hUsd ?? 0), 0);
  const openInterest = rows.reduce((sum, row) => sum + (row.openInterestUsd ?? 0), 0);
  const funded = rows.filter((row) => row.marketType === "perp" && row.fundingRateAnnualized !== null && (row.openInterestUsd ?? 0) > 0);
  const fundedOi = funded.reduce((sum, row) => sum + row.openInterestUsd!, 0);
  const funding = fundedOi > 0 ? funded.reduce((sum, row) => sum + row.fundingRateAnnualized! * row.openInterestUsd!, 0) / fundedOi : null;
  const main = rows.filter((row) => !row.offBasis && !row.issuer);
  const tokens = rows.filter((row) => row.issuer);
  // With an off-chain price, a spot quote more than 3× away is another unit and is left out; without one there is nothing to check against.
  const sameUnit = (price: number | null) => price !== null && price > 0 && (!company.offchainPrice || spotPremium(price, company) !== null);
  const spot = vwap(main.filter((row) => row.marketType === "spot" && sameUnit(row.price)));
  const issuer = median(tokens.flatMap((token) => sameUnit(token.price) ? [token.price!] : []));
  const implied = type !== "spot" && main.some((row) => row.marketType === "perp") ? company.impliedSharePrice : null;
  const pick: [number | null, string, boolean][] = [
    [implied, "implied a share", true],
    [spot, "spot, volume-weighted", true],
    [issuer, "issuer tokens, median", true],
    [vwap(main), "venue quote, volume-weighted", false],
  ];
  const [price, basis, perShare] = pick.find(([value]) => value !== null) ?? [null, "no price", false];
  return { price, basis, perShare, volume, openInterest, funding };
}

export function ProHome() {
  const data = useProData();
  const { companies, markets, totals, loading, error, refresh } = data;
  const history = useHistory();
  const index = useMemo(() => historyIndex(history.data), [history.data]);
  const colour = useMemo(() => new Map([...companies].sort((a, b) => b.totals.volume30dUsd - a.totals.volume30dUsd).map((company, position) => [company.slug, COLOURS[position % COLOURS.length]])), [companies]);

  const [metric, setMetric] = useState<StackMetric>("value");
  const [stackType, setStackType] = useState<AssetType | "all">("all");
  const [league, setLeague] = useState<League>("venue");
  const [leagueType, setLeagueType] = useState<AssetType | "all">("all");
  const [constituents, setConstituents] = useState(false);
  const [volCompany, setVolCompany] = useState("all");
  const [type, setType] = useState<AssetType | "all">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [venue, setVenue] = useState("all");
  const [minVolume, setMinVolume] = useState(0);
  const [activeOnly, setActiveOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("volume24hUsd");
  const [direction, setDirection] = useState(-1);

  // The sidebar's asset-type links land here with ?type=perp|spot.
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get("type");
      setType(value === "perp" || value === "spot" ? value : "all");
    };
    const timer = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, []);

  // The one crosshair skeleton on this page: Figure 1, while coverage or daily history loads.
  const figureSkeleton = useCrosshair(loading || (!history.data && !history.error));
  const asOf = data.data ? IST_TIME.format(new Date(data.data.updatedAt)) : "—";
  const historyReady = !!history.data;

  // 1. Stacked chart.
  const stack = useMemo(() => stackedSeries(companies, index, metric, stackType), [companies, index, metric, stackType]);
  const stackSeries: Series[] = stack.companies.map((item) => ({ key: item.slug, name: item.name, colour: colour.get(item.slug) ?? "var(--series-rest)" }));
  const stackLast = stack.rows[stack.rows.length - 1];
  const stackFirst = stack.rows[0];
  const sumRow = (row: typeof stackLast | undefined) => row ? stack.companies.reduce((total, item) => total + Number(row[item.slug]), 0) : null;
  const stackTotal = sumRow(stackLast);
  const stackChange = stackTotal !== null && sumRow(stackFirst) ? stackTotal / sumRow(stackFirst)! - 1 : null;

  // 2. League table and donut.
  const leagueMarkets = markets.filter((market) => leagueType === "all" || market.marketType === leagueType);
  const groupOf = (market: FlatMarket) => league === "venue" ? venueName(market.venue) : league === "provider" ? market.provider : league === "company" ? market.company.name : TYPE_INFO[market.marketType].name;
  const leagueRows = [...new Set(leagueMarkets.map(groupOf))].map((name) => {
    const rows = leagueMarkets.filter((market) => groupOf(market) === name);
    return {
      name, count: rows.length,
      companies: new Set(rows.map((row) => row.company.slug)).size,
      volume: rows.reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0),
      oi: rows.reduce((sum, row) => sum + (row.openInterestUsd ?? 0), 0),
      logo: league === "company" ? rows[0].company : null,
    };
  }).sort((a, b) => b.volume - a.volume);
  const leagueTotal = leagueRows.reduce((sum, row) => sum + row.volume, 0);
  const donut = [...leagueRows.slice(0, 6), ...(leagueRows.length > 6 ? [{ name: "Other", volume: leagueRows.slice(6).reduce((sum, row) => sum + row.volume, 0) }] : [])]
    .filter((row) => row.volume > 0).map((row, position) => ({ name: row.name, value: row.volume, colour: row.name === "Other" ? "var(--series-rest)" : COLOURS[position % COLOURS.length] }));

  // 3. Index and volatility.
  const indexSeries = useMemo(() => valuationIndex(companies, index, 90), [companies, index]);
  const indexLast = indexSeries.rows[indexSeries.rows.length - 1];
  const indexLines: Series[] = [
    { key: "index", name: "Pre-IPO index", colour: "var(--series-1)", width: 2.5 },
    ...(constituents ? indexSeries.companies.map((item) => ({ key: item.slug, name: item.name, colour: colour.get(item.slug) ?? "var(--series-rest)", width: 1.25, dashed: true })) : []),
  ];
  const volatility = useMemo(() => rollingVolatility(companies, index, VOL_WINDOW), [companies, index]);
  const volLines: Series[] = volatility.companies.filter((item) => volCompany === "all" || item.slug === volCompany)
    .map((item) => ({ key: item.slug, name: item.name, colour: colour.get(item.slug) ?? "var(--series-rest)" }));

  // 5. Every market.
  const chg = (market: FlatMarket, days: number) => market.issuer ? (days === 30 ? market.issuer.change30d : null) : marketChange(index.get(marketKey(market))?.points, days);
  const query = search.trim().toLowerCase();
  const filtered = markets.filter((market) => (type === "all" || market.marketType === type)
    && (picked.length === 0 || picked.includes(market.company.slug))
    && (venue === "all" || market.venue === venue)
    && (market.volume24hUsd ?? 0) >= minVolume
    && (!activeOnly || (market.volume24hUsd ?? 0) > 0)
    && (!query || `${market.label} ${market.company.name} ${market.provider} ${venueName(market.venue)}`.toLowerCase().includes(query)));
  const value = (market: FlatMarket, key: SortKey) => key === "chg1" ? chg(market, 1) : key === "chg30" ? chg(market, 30)
    : key === "premium" ? (market.marketType === "spot" ? spotPremium(market.price, market.company) : null) : market[key];
  const sorted = [...filtered].sort((a, b) => {
    const left = value(a, sort);
    const right = value(b, sort);
    if (left === null && right === null) { return 0; }
    if (left === null) { return 1; }
    if (right === null) { return -1; }
    return direction * (left - right);
  });
  // All markets is one row per company; its sources open beneath it.
  const groups = companies.map((company) => {
    const rows = sorted.filter((market) => market.company.slug === company.slug);
    return { company, rows, agg: aggregate(company, rows, type) };
  }).filter((group) => group.rows.length > 0);
  const groupValue = (group: (typeof groups)[number], key: SortKey): number | null => {
    const { agg, company } = group;
    switch (key) {
      case "price": return agg.price;
      case "premium": return agg.perShare ? spotPremium(agg.price, company) : null;
      case "volume24hUsd": return agg.volume;
      case "openInterestUsd": return agg.openInterest || null;
      case "fundingRateAnnualized": return agg.funding;
      case "chg1": return seriesChange(company, 1);
      case "chg30": return seriesChange(company, 30);
    }
  };
  const sortedGroups = [...groups].sort((a, b) => {
    const left = groupValue(a, sort);
    const right = groupValue(b, sort);
    if (left === null && right === null) { return a.company.name.localeCompare(b.company.name); }
    if (left === null) { return 1; }
    if (right === null) { return -1; }
    return direction * (left - right);
  });
  const allOpen = sortedGroups.length > 0 && sortedGroups.every((group) => expanded.includes(group.company.slug));
  const toggleGroup = (slug: string) => setExpanded((current) => current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]);
  function toggleSort(key: SortKey) {
    if (key === sort) { setDirection((current) => -current); } else { setSort(key); setDirection(-1); }
  }
  const sortHead = (key: SortKey, label: string, className: string) => <th className={`r ${className}`} aria-sort={sort === key ? direction < 0 ? "descending" : "ascending" : "none"}>
    <button type="button" className="p-sort" data-on={sort === key} onClick={() => toggleSort(key)}>{label}{sort === key ? direction < 0 ? " ↓" : " ↑" : ""}</button>
  </th>;
  const typeCount = (key: AssetType | "all") => markets.filter((market) => key === "all" || market.marketType === key).length;

  return <ProShell active="home" data={data} history={history.data}>
    <main className="p-wrap p-main">
      {error && data.data && <div className="p-notice" role="alert">{error} Showing the last successful read.</div>}
      <MarketSummary companies={companies} loading={loading} variant="pro" history={history.data} />
      <NewsPills companies={companies} />
      {HEAT_MAP_ENABLED && <HeatMap companies={companies} loading={loading} variant="pro" history={history.data} />}

      {loading ? <>
          <section className="p-panel" aria-label="Figure 1 loading">
            <PHead title="Total value, by company" />
            <div className="p-pad"><div ref={figureSkeleton}><FigurePlaceholder /></div></div>
          </section>
          <section className="p-league"><div className="p-panel"><SkeletonTable rows={7} cols={6} label="Loading league table" /></div><div className="p-panel p-pad"><SkeletonChart height={300} label="Loading share of volume" /></div></section>
          <div className="p-panel"><SkeletonTable rows={8} cols={7} label="Loading markets" /></div>
        </>
        : error && !data.data ? <div className="p-panel"><DataState error title="Market data unavailable" description={error} action={refresh} /></div>
        : <>
          <section className="p-panel" aria-labelledby="p-stack-h">
            <PHead title={metric === "value" ? "Total value, by company" : "Daily traded volume, by company"} id="p-stack-h"
              note={metric === "value" ? "How much the covered companies are worth together, day by day, and which company each layer is." : "Money traded each day across every market, stacked by company."}>
              <button type="button" className="p-btn p-btn-outline p-btn-sm" disabled={!stack.rows.length}
                onClick={() => download(`pre-ipo-${metric}-${stackType}.csv`, ["date", ...stack.companies.map((item) => item.name)], stack.rows.map((row) => [row.at, ...stack.companies.map((item) => Number(row[item.slug]))]))}>
                <Download size={13} />Download CSV
              </button>
            </PHead>
            <div className="p-controls">
              <div className="p-control"><span className="p-lbl">Metric</span>
                <div className="p-seg square" role="group" aria-label="Metric">
                  <button type="button" aria-pressed={metric === "value"} onClick={() => setMetric("value")}>Total value</button>
                  <button type="button" aria-pressed={metric === "volume"} onClick={() => setMetric("volume")}>Daily volume</button>
                  <button type="button" disabled title="Venues report open interest only as a current figure, so there is no daily history to chart.">Open interest —</button>
                </div>
              </div>
              <div className="p-control"><span className="p-lbl p-tip">Asset type<AssetTypeTip /></span>
                <div className="p-seg square" role="group" aria-label="Asset type">
                  {(["perp", "spot", "all"] as const).map((key) => <button key={key} type="button" aria-pressed={stackType === key} onClick={() => setStackType(key)}>{key === "all" ? "All" : TYPE_INFO[key].name}</button>)}
                </div>
              </div>
            </div>
            <div className="p-pad">
              <div className="p-row-between p-row-wrap">
                <span className="p-row-base"><span className="p-mono p-chart-total">{compactUsd(stackTotal)}</span>
                  {stack.rows.length > 1 && <><PChg value={stackChange} arrow /><span className="p-faint">over {stack.rows.length - 1} days{metric === "volume" ? " · last complete day" : ""}</span></>}</span>
                <div className="p-legend">{stackSeries.map((item) => <span key={item.key}><i style={{ background: item.colour }} />{item.name}</span>)}</div>
              </div>
              {!historyReady ? history.error ? <div className="p-chart-empty">Market history is unavailable right now.</div> : <div ref={figureSkeleton}><FigurePlaceholder /></div>
                : stack.rows.length > 1 ? <StackedArea rows={stack.rows} series={stackSeries} format={compactUsd} />
                : <div className="p-chart-empty">No days on which every company has a {metric === "value" ? "close" : "volume figure"} for this asset type.</div>}
            </div>
            <div className="p-panel-foot">
              <span>{metric === "value"
                ? "Today's off-chain valuation, carried back through the market: each day = valuation × (that day's median main-basis close ÷ the latest one). Ratios only, so share- and valuation-quoted perps both work. Drag the handles under the chart to change the range."
                : "Sum of each market's daily candle volume in USD (Hyperliquid: base volume × close). Today's unfinished candle is left out."}</span>
              <span>{stack.excluded.length ? `No off-chain valuation: ${stack.excluded.map((item) => item.name).join(", ")} (—)` : `${plural(stack.rows.length, "day")} with data for every company`}</span>
            </div>
          </section>

          <section className="p-league" aria-labelledby="p-league-h">
            <div className="p-panel">
              <PHead title="League table" id="p-league-h" aside={`30D volume, as of ${asOf}`}
                note="Who carries the trading. Switch the grouping to rank venues, data providers, companies or asset types." />
              <div className="p-tabs" role="group" aria-label="Group by">
                {([["venue", "Venues"], ["provider", "Providers"], ["company", "Companies"], ["type", "Asset types"]] as const).map(([key, label]) => (
                  <button key={key} type="button" aria-pressed={league === key} onClick={() => setLeague(key)}>{label}</button>
                ))}
              </div>
              <table className="p-table p-fit">
                <thead><tr><th className="p-lc-rank">#</th><th>Name</th><th className="r">Markets</th><th className="r p-lc-co">Companies</th><th className="r">30D volume</th><th className="r p-lc-oi">Open interest</th><th className="r p-lc-share">Share</th></tr></thead>
                <tbody>{leagueRows.map((row, position) => <tr key={row.name}>
                  <td className="p-mono p-faint p-lc-rank">{position + 1}</td>
                  <td><span className="p-prov">{row.logo ? <Logo name={row.logo.name} logo={row.logo.logo} size={20} /> : (league === "provider" || league === "venue") && <VenueLogo name={row.name} size={20} />}<strong>{row.name}</strong></span></td>
                  <td className="r p-mono">{row.count}</td>
                  <td className="r p-mono p-lc-co">{row.companies}</td>
                  <td className="r p-mono">{compactUsd(row.volume)}</td>
                  <td className="r p-mono p-lc-oi">{row.oi ? compactUsd(row.oi) : "—"}</td>
                  <td className="r p-mono p-lc-share">{share(row.volume, leagueTotal)}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="p-panel">
              <PHead title="Share of 30D volume" note="The league table as slices: a ring with one dominant slice means volume is concentrated in one place." aside={{ venue: "by venue", provider: "by provider", company: "by company", type: "by asset type" }[league]} />
              <div className="p-controls">
                <div className="p-seg square" role="group" aria-label="Asset type">
                  {(["perp", "spot", "all"] as const).map((key) => <button key={key} type="button" aria-pressed={leagueType === key} onClick={() => setLeagueType(key)}>{key === "all" ? "All" : TYPE_INFO[key].tag}</button>)}
                </div>
                <span className="p-faint p-mono">as of {asOf}</span>
              </div>
              {donut.length ? <ShareDonut slices={donut} format={compactUsd} /> : <PEmpty>No volume for this asset type.</PEmpty>}
              <div className="p-legend p-pad">{donut.map((slice) => <span key={slice.name}><i style={{ background: slice.colour }} />{slice.name} <strong className="p-mono">{share(slice.value, leagueTotal)}</strong></span>)}</div>
            </div>
          </section>

          <section className="p-pair">
            <div className="p-panel">
              <PHead title="Pre-IPO index, valuation-weighted" note="The whole market as one line, starting at 100. Above the dotted line, prices are up since the first day shown." aside={indexLast ? <span className="p-mono">{Number(indexLast.index).toFixed(1)}</span> : "—"}>
                <label className="p-check inline"><input type="checkbox" checked={constituents} onChange={(event) => setConstituents(event.target.checked)} /><span>Show constituents</span></label>
              </PHead>
              <div className="p-pad">
                {!historyReady ? <SkeletonChart height={260} label="Loading daily candles" />
                  : indexSeries.rows.length > 1 ? <MultiLine rows={indexSeries.rows} series={indexLines} format={(value) => value.toFixed(0)} reference={100} />
                  : <div className="p-chart-empty">—</div>}
              </div>
              <div className="p-panel-foot"><span>Each company&apos;s median main-basis close, rebased to 100 on the first shared day and weighted by off-chain valuation (fixed). Source: venue daily candles.</span></div>
            </div>
            <div className="p-panel">
              <PHead title={`Realized volatility, ${VOL_WINDOW}-day`} note="How sharply prices have been swinging. Higher means larger daily moves in either direction.">
                <label className="p-select"><span className="sr-only">Company</span>
                  <select value={volCompany} onChange={(event) => setVolCompany(event.target.value)}>
                    <option value="all">All companies</option>
                    {volatility.companies.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
                  </select>
                </label>
              </PHead>
              <div className="p-pad">
                {!historyReady ? <SkeletonChart height={260} label="Loading daily candles" />
                  : volatility.rows.length > 1 ? <MultiLine rows={volatility.rows} series={volLines} format={pctAxis} />
                  : <div className="p-chart-empty">—</div>}
              </div>
              <div className="p-panel-foot"><span>Annualized standard deviation of {VOL_WINDOW} consecutive daily log returns of the median close (×√365; these venues trade daily). A missing day breaks the window.</span></div>
            </div>
          </section>

          <section className="p-panel" id="markets" aria-labelledby="p-all-h">
            <PHead title={<>All markets <span className="p-mono p-faint">({plural(sortedGroups.length, "company")}, {plural(sorted.length, "source")})</span></>} id="p-all-h"
              note="One row per company with its figures combined across every source. Open a row with its arrow to see each market and issuer token on its own.">
              <button type="button" className="p-btn p-btn-outline p-btn-sm" disabled={!sortedGroups.length} aria-pressed={allOpen}
                onClick={() => setExpanded(allOpen ? [] : sortedGroups.map((group) => group.company.slug))}>{allOpen ? "Collapse all" : "Show all sources"}</button>
              <button type="button" className="p-btn p-btn-outline p-btn-sm" disabled={!sorted.length}
                onClick={() => download("pre-ipo-markets.csv", ["company", "market", "provider", "venue", "type", "price", "vs_offchain", "volume_24h_usd", "open_interest_usd", "funding_apr", "change_1d", "change_30d"],
                  sorted.map((market) => [market.company.name, market.label, market.provider, market.issuer ? market.issuer.chain : venueName(market.venue), market.marketType, market.price, value(market, "premium"), market.volume24hUsd, market.openInterestUsd, market.fundingRateAnnualized, chg(market, 1), chg(market, 30)]))}>
                <Download size={13} />CSV
              </button>
            </PHead>
            <div className="p-chiprow" role="group" aria-label="Asset type">
              <span className="p-lbl p-tip">Asset type<AssetTypeTip /></span>
              {(["all", "perp", "spot"] as const).map((key) => <button key={key} type="button" className="p-chip big" aria-pressed={type === key} onClick={() => setType(key)}>
                {key === "all" ? "All markets" : TYPE_INFO[key].name}<span className="p-mono">{typeCount(key)}</span></button>)}
            </div>
            <div className="p-filters">
              <CompanyFilter companies={companies} selected={picked} onChange={setPicked} count={(item) => item.rows.filter((row) => type === "all" || row.marketType === type).length} />
              <label className="p-search grow"><span className="sr-only">Search markets</span>
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search market, company, provider" style={{ paddingLeft: 10 }} />
              </label>
              <label className="p-select"><span className="p-lbl">Venue</span>
                <select value={venue} onChange={(event) => setVenue(event.target.value)}>
                  <option value="all">All venues</option>
                  {totals.venues.map((name) => <option key={name} value={name}>{venueName(name)}</option>)}
                </select>
              </label>
              <label className="p-select"><span className="p-lbl">Min 24h vol</span>
                <select value={minVolume} onChange={(event) => setMinVolume(Number(event.target.value))}>
                  {MIN_VOLUME.map((amount) => <option key={amount} value={amount}>{amount ? compactUsd(amount) : "Any"}</option>)}
                </select>
              </label>
              <label className="p-check inline"><input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /><span>Active only</span></label>
            </div>
            <table className="p-table p-fit p-markets">
              <caption className="sr-only">Every covered market, perpetual and spot, with price, volume, open interest, funding and daily-close changes.</caption>
              <thead><tr>
                <th className="p-mc-rank">#</th>
                <th>Company / venue</th>
                <th className="p-mc-prov">Source</th>
                <th className="p-mc-type">Type</th>
                {sortHead("price", "Price", "")}
                {sortHead("premium", "vs off-chain", "p-mc-prem")}
                {sortHead("volume24hUsd", "24h vol", "p-mc-vol")}
                {sortHead("openInterestUsd", "Open int.", "p-mc-oi")}
                {sortHead("fundingRateAnnualized", "Funding", "p-mc-fund")}
                {sortHead("chg1", "1D", "p-mc-chg1")}
                {sortHead("chg30", "30D", "")}
              </tr></thead>
              <tbody>
                {sortedGroups.map((group, position) => {
                  const { company, rows, agg } = group;
                  const open = expanded.includes(company.slug);
                  const sources = rows.length;
                  const tokens = rows.filter((row) => row.issuer).length;
                  const providers = [...new Set(rows.map((row) => row.provider))];
                  const types = (["perp", "spot"] as const).filter((key) => rows.some((row) => row.marketType === key));
                  const childId = `p-src-${company.slug}`;
                  return <Fragment key={company.slug}>
                    <tr className={`p-group-row ${open ? "open" : ""}`}>
                      <td className="p-mc-rank"><span className="p-group-rank">
                        <button type="button" className="p-expand" aria-expanded={open} aria-controls={childId}
                          aria-label={`${open ? "Hide" : "Show"} ${plural(sources, "source")} for ${company.name}`} onClick={() => toggleGroup(company.slug)}><ChevronRight size={15} /></button>
                        <span className="p-mono p-faint">{position + 1}</span></span></td>
                      <td className="p-mc-market"><Link href={`/company/${company.slug}`} className="p-mc-id">
                        <Logo name={company.name} logo={company.logo} size={26} />
                        <span className="p-mc-text"><strong>{company.name}</strong>
                          <small className="p-mc-pairline">{plural(sources, "source")}{tokens ? `, ${plural(tokens, "issuer token")}` : ""}</small></span>
                      </Link></td>
                      <td className="p-mc-prov"><span className="p-stack-logos">
                        {providers.slice(0, 4).map((name) => <ExchangeMark key={name} provider={name} venue={null} size={20} />)}
                        {providers.length > 4 && <span className="p-mono p-faint">+{providers.length - 4}</span>}
                      </span></td>
                      <td className="p-mc-type"><span className="p-type-tags">{types.map((key) => <TypeTag key={key} type={key} />)}</span></td>
                      <td className="r"><span className="p-stack-cell"><strong className="p-mono"><Flash value={agg.price}>{marketPrice(agg.price)}</Flash></strong><small>{agg.basis}</small></span></td>
                      <td className="r p-mc-prem">{agg.perShare ? <PPremium value={spotPremium(agg.price, company)} /> : <span className="p-faint">—</span>}</td>
                      <td className="r p-mono p-mc-vol">{compactUsd(agg.volume)}</td>
                      <td className="r p-mono p-mc-oi">{agg.openInterest ? compactUsd(agg.openInterest) : "—"}</td>
                      <td className="r p-mc-fund"><PFund value={agg.funding} /></td>
                      <td className="r p-mc-chg1"><PChg value={seriesChange(company, 1)} /></td>
                      <td className="r"><PChg value={seriesChange(company, 30)} /></td>
                    </tr>
                    {open && rows.map((market) => <tr key={marketKey(market)} className={`p-child-row ${market.offBasis ? "p-off" : ""}`} data-group={childId}>
                      <td className="p-mc-rank" aria-hidden />
                      {/* Child rows: the venue (exchange, or the chain an issuer token lives on) first, then the source that lists it there. */}
                      <td className="p-mc-market"><span className="p-mc-id p-child-id">
                        <VenueLogo name={market.issuer ? market.issuer.chain : venueName(market.venue)} size={22} />
                        <span className="p-mc-text"><strong>{market.issuer ? market.issuer.chain : venueName(market.venue)}</strong>
                          <small className="p-mc-pairline p-mono">{market.label}{market.offBasis ? ", other basis" : ""}</small></span>
                      </span></td>
                      <td className="p-mc-prov"><span className="p-src-cell">
                        <ExchangeMark provider={market.provider} venue={null} size={20} />
                        <span className="p-mc-text"><strong>{market.provider}</strong>
                          <small className="p-faint">{market.issuer ? "issuer token" : market.provider === venueName(market.venue) ? "direct" : market.marketType === "spot" ? `spot on ${venueName(market.venue)}` : `deployer on ${venueName(market.venue)}`}</small></span>
                      </span></td>
                      <td className="p-mc-type"><TypeTag type={market.marketType} /></td>
                      <td className="r p-mono">{market.issuer && market.tradeUrl
                        ? <a className="p-ext" href={market.tradeUrl} target="_blank" rel="noopener noreferrer" aria-label={`${marketPrice(market.price)} on ${market.provider}, opens in a new tab`}>{marketPrice(market.price)}</a>
                        : <Flash value={market.price}>{marketPrice(market.price)}</Flash>}</td>
                      <td className="r p-mc-prem">{market.marketType === "spot" ? <PPremium value={spotPremium(market.price, company)} /> : <span className="p-faint" title="Perps quote a valuation share, not a share price">—</span>}</td>
                      <td className={`r p-mono p-mc-vol ${market.issuer ? "p-faint" : ""}`}>{market.issuer ? "—" : compactUsd(market.volume24hUsd)}</td>
                      <td className={`r p-mono p-mc-oi ${market.issuer ? "p-faint" : ""}`}>{market.issuer ? "—" : compactUsd(market.openInterestUsd)}</td>
                      <td className="r p-mc-fund"><PFund value={market.fundingRateAnnualized} /></td>
                      <td className="r p-mc-chg1"><PChg value={chg(market, 1)} /></td>
                      <td className="r"><PChg value={chg(market, 30)} /></td>
                    </tr>)}
                  </Fragment>;
                })}
                {!sortedGroups.length && <tr><td colSpan={11}><PEmpty>No markets match these filters.</PEmpty></td></tr>}
              </tbody>
            </table>
            <div className="p-panel-foot"><span>A company&apos;s price is for one share where the data allows: the share price its confirmed-basis markets imply, else the volume-weighted spot price, else the issuers&apos; median token price; the line under it says which. Inside a row, Quote is each venue&apos;s own price, and most perps quote valuation ÷ notional shares. Volume and open interest are summed, funding is open-interest weighted, and 1D and 30D follow the most-traded market. vs off-chain is a spot price against the off-chain price for one share: a premium above zero, a discount below. 1D and 30D are each market&apos;s own daily closes; — where it has no candle that far back. Funding is annualized.</span><span>{plural(markets.length, "market")} · {plural(totals.venues.length, "venue")}</span></div>
          </section>
        </>}
    </main>
  </ProShell>;
}
