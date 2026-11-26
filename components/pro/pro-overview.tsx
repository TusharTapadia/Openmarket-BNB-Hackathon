"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { compactUsd, marketPrice, plural, spotPremium, TYPE_INFO, type AssetType } from "@/lib/coverage-view";
import { DataState } from "@/components/data-state";
import { ProShell } from "./pro-shell";
import { Flash } from "@/components/flash";
import { ExchangeMark, VenueLogo } from "@/components/exchange-mark";
import { Exchange } from "./pro-kit";
import { AssetTypeTip, IST_TIME, PChg, PEmpty, PFund, PHead, PPremium, PShare, seriesChange, share, TypeTag, useProData, venueName, type FlatMarket } from "./pro-kit";

/**
 * Pro market overview: the "market overview (institutional)" artboard.
 * Navy hero with the headline figures, then numbered figures and tables, all
 * built from the coverage payload.
 */

type Metric = "volume" | "oi" | "fees";
type League = "provider" | "venue" | "company" | "type";
type SortKey = "price" | "premium" | "volume30dUsd" | "chg30" | "openInterestUsd" | "fundingRateAnnualized";

const METRICS: { key: Metric; label: string; pick: (market: FlatMarket) => number }[] = [
  { key: "volume", label: "30D Trading Volume", pick: (market) => market.volume30dUsd ?? 0 },
  { key: "oi", label: "Open Interest", pick: (market) => market.openInterestUsd ?? 0 },
  { key: "fees", label: "Est. Fees, 30D", pick: (market) => market.estFees30dUsd ?? 0 },
];
const VENUE_COLOURS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-6)", "var(--series-7)", "var(--series-8)", "var(--series-4)", "var(--series-5)"];
const PAGE = 12;

const keyOf = (market: FlatMarket) => `${market.venue}-${market.marketType}-${market.market}`;

/** 30-day change for the one market whose closes we hold: each company's lead. */
function marketChange(market: FlatMarket): number | null {
  if (market.issuer) { return market.issuer.change30d; }
  const lead = market.company.seriesMarket;
  if (!lead || lead.label !== market.label || lead.venue !== market.venue) { return null; }
  return seriesChange(market.company, 30);
}

function csv(markets: FlatMarket[]) {
  const head = ["company", "market", "provider", "venue", "type", "price", "vs_offchain", "volume_24h_usd", "volume_30d_usd", "open_interest_usd", "funding_apr", "est_fees_30d_usd", "captured_at"];
  const cell = (value: unknown) => value === null || value === undefined ? "" : /[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value);
  const rows = markets.map((market) => [market.company.name, market.label, market.provider, venueName(market.venue), market.marketType, market.price, market.marketType === "spot" ? spotPremium(market.price, market.company) : null, market.volume24hUsd, market.volume30dUsd, market.openInterestUsd, market.fundingRateAnnualized, market.estFees30dUsd, market.capturedAt].map(cell).join(","));
  const blob = new Blob([[head.join(","), ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pre-ipo-markets-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ProOverview() {
  const data = useProData();
  const { companies, markets, totals, loading, error, refresh } = data;
  const [metric, setMetric] = useState<Metric>("volume");
  const [asset, setAsset] = useState<AssetType | "all">("all");
  const [league, setLeague] = useState<League>("provider");
  const [sideType, setSideType] = useState<AssetType | "all">("all");
  const [sideProvider, setSideProvider] = useState("all");
  const [sideSector, setSideSector] = useState("all");
  const [sideVenue, setSideVenue] = useState("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [basisOnly, setBasisOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("volume30dUsd");
  const [direction, setDirection] = useState(-1);
  const [showAll, setShowAll] = useState(false);

  const asOf = data.data ? IST_TIME.format(new Date(data.data.updatedAt)) : "—";
  const venueColour = new Map(totals.venues.map((name, index) => [name, VENUE_COLOURS[index % VENUE_COLOURS.length]]));
  const sectors = [...new Set(companies.flatMap((company) => company.sector ? [company.sector] : []))].sort();

  // Headline figures. Prior-period comparisons need stored snapshots the API does not keep yet.
  const kpis = [
    { label: "30D Volume", note: "1", value: compactUsd(totals.volume30) },
    { label: "Open Interest", note: "2", value: compactUsd(totals.openInterest) },
    { label: "24H Volume", note: "", value: compactUsd(totals.volume24) },
    { label: "Est. Fees, 30D", note: "", value: compactUsd(totals.fees) },
    { label: "Markets", note: "", value: loading ? "—" : String(markets.length) },
    { label: "Data Providers", note: "", value: loading ? "—" : String(totals.providers.length) },
  ];

  // Figure 1: each company's metric, split by venue.
  const pick = METRICS.find((item) => item.key === metric)!;
  const inAsset = markets.filter((market) => asset === "all" || market.marketType === asset);
  const figure = companies.map((company) => {
    const rows = inAsset.filter((market) => market.company.slug === company.slug);
    const segments = totals.venues.map((venue) => ({ venue, value: rows.filter((row) => row.venue === venue).reduce((sum, row) => sum + pick.pick(row), 0) })).filter((segment) => segment.value > 0);
    return { company, total: segments.reduce((sum, segment) => sum + segment.value, 0), segments };
  }).sort((a, b) => b.total - a.total);
  const figureTotal = figure.reduce((sum, item) => sum + item.total, 0);
  const figureMax = Math.max(0, ...figure.map((item) => item.total));
  const figureVenues = totals.venues.filter((venue) => figure.some((item) => item.segments.some((segment) => segment.venue === venue)));

  // Table 1: providers.
  const providers = totals.providers.map((name) => {
    const rows = markets.filter((market) => market.provider === name);
    const quiet = rows.filter((row) => !((row.volume24hUsd ?? 0) > 0)).length;
    return {
      name, rows,
      companies: [...new Set(rows.map((row) => row.company.name))],
      types: [...new Set(rows.map((row) => row.marketType))],
      venues: [...new Set(rows.map((row) => venueName(row.venue)))],
      volume: rows.reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0),
      oi: rows.reduce((sum, row) => sum + (row.openInterestUsd ?? 0), 0),
      // An issuer quotes its own token price; it has no venue volume to be quiet about.
      status: rows.every((row) => row.issuer) ? "Issuer quote" : quiet === 0 ? "Active" : quiet === rows.length ? "No 24h volume" : `${quiet} of ${rows.length} quiet`,
      tone: rows.every((row) => row.issuer) ? "live" : quiet === 0 ? "live" : quiet === rows.length ? "stale" : "partial",
    };
  }).sort((a, b) => b.volume - a.volume);

  // Table 2: league table, grouped as chosen.
  const groupKey = (market: FlatMarket) => league === "provider" ? market.provider : league === "venue" ? venueName(market.venue) : league === "company" ? market.company.name : TYPE_INFO[market.marketType].name;
  const leagueRows = [...new Set(markets.map(groupKey))].map((name) => {
    const rows = markets.filter((market) => groupKey(market) === name);
    return { name, count: rows.length, volume: rows.reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0), oi: rows.reduce((sum, row) => sum + (row.openInterestUsd ?? 0), 0) };
  }).sort((a, b) => b.volume - a.volume);

  // Figure 2, Figure 3, Table 3.
  const typeSplit = (["perp", "spot"] as const).map((key) => {
    const rows = markets.filter((market) => market.marketType === key);
    return { key, count: rows.length, volume: rows.reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0) };
  }).filter((item) => item.count > 0);
  const fundBars = markets.filter((market) => market.marketType === "perp" && market.fundingRateAnnualized !== null)
    .sort((a, b) => (b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0)).slice(0, 8);
  const maxFund = Math.max(0.0001, ...fundBars.map((market) => Math.abs(market.fundingRateAnnualized ?? 0)));
  const largest = [...markets].sort((a, b) => (b.volume30dUsd ?? 0) - (a.volume30dUsd ?? 0)).slice(0, 6);

  // Table 4: every market, filtered from the sidebar.
  const filtered = markets.filter((market) => (sideType === "all" || market.marketType === sideType)
    && (sideProvider === "all" || market.provider === sideProvider)
    && (sideSector === "all" || market.company.sector === sideSector)
    && (sideVenue === "all" || market.venue === sideVenue)
    && (!activeOnly || (market.volume24hUsd ?? 0) > 0)
    && (!basisOnly || !market.offBasis));
  const value = (market: FlatMarket, key: SortKey) => key === "chg30" ? marketChange(market) : key === "premium" ? (market.marketType === "spot" ? spotPremium(market.price, market.company) : null) : market[key];
  const sorted = [...filtered].sort((a, b) => {
    const left = value(a, sort);
    const right = value(b, sort);
    if (left === null && right === null) { return 0; }
    if (left === null) { return 1; }
    if (right === null) { return -1; }
    return direction * (left - right);
  });
  const shown = showAll ? sorted : sorted.slice(0, PAGE);
  function toggleSort(key: SortKey) {
    if (key === sort) { setDirection((current) => -current); } else { setSort(key); setDirection(-1); }
  }
  const count = (test: (market: FlatMarket) => boolean) => markets.filter(test).length;

  return <ProShell active="report" data={data}>
    <section className="p-hero" aria-labelledby="p-hero-h">
      <div className="p-wrap p-hero-inner">
        <div className="p-hero-head">
          <div className="p-hero-copy">
            <span className="p-kicker">Market Overview · {asOf}</span>
            <h1 id="p-hero-h">Pre-IPO Secondary &amp; Derivatives Markets</h1>
            <p>Consolidated trading activity in private-company exposure across perpetual futures and spot tokens, sourced from {plural(totals.providers.length, "data provider")} on {plural(totals.venues.length, "venue")}.</p>
          </div>
          <div className="p-hero-actions">
            <button type="button" className="p-btn p-btn-ghost-dark" onClick={() => csv(markets)} disabled={!markets.length}><Download size={14} />Export CSV</button>
          </div>
        </div>
        <div className="p-kpi-strip" aria-label="Key metrics">
          {kpis.map((kpi) => <div key={kpi.label}>
            <span className="p-kicker">{kpi.label}{kpi.note && <sup>{kpi.note}</sup>}</span>
            <strong className="p-mono">{loading ? "—" : kpi.value}</strong>
            <small className="p-mono">— vs 30D prior</small>
          </div>)}
        </div>
      </div>
    </section>

    <main className="p-wrap p-main">
      {error && data.data && <div className="p-notice" role="alert">{error} Showing the last successful read.</div>}
      {loading ? <div className="p-panel"><DataState loading title="Loading market data" description="Reading every market that trades these companies." /></div>
        : error && !data.data ? <div className="p-panel"><DataState error title="Market data unavailable" description={error} action={refresh} /></div>
        : <>
          <section className="p-panel" aria-labelledby="p-fig1">
            <PHead title={`${pick.label}, by Company`} id="p-fig1">
              <div className="p-row-wrap">
                <div className="p-seg square" role="group" aria-label="Asset type">
                  {(["all", "perp", "spot"] as const).map((key) => <button key={key} type="button" aria-pressed={asset === key} onClick={() => setAsset(key)}>{key === "all" ? "All" : TYPE_INFO[key].tag}</button>)}
                </div>
              </div>
            </PHead>
            <div className="p-tabs" role="group" aria-label="Metric">
              {METRICS.map((item) => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}
            </div>
            <div className="p-pad">
              <div className="p-row-between p-row-wrap">
                <span className="p-row-base"><span className="p-mono p-chart-total">{compactUsd(figureTotal)}</span><span className="p-faint">{asset === "all" ? "all asset types" : TYPE_INFO[asset].name} · split by venue</span></span>
                <div className="p-legend">{figureVenues.map((venue) => <span key={venue}><i style={{ background: venueColour.get(venue) }} />{venueName(venue)}</span>)}</div>
              </div>
              <div className="p-hbars" role="img" aria-label={`${pick.label} by company, split by venue`}>
                {figure.map((item) => <div key={item.company.slug} className="p-hbar">
                  <Link href={`/company/${item.company.slug}`} className="p-hbar-name">{item.company.name}</Link>
                  <span className="p-hbar-track">
                    <span style={{ width: `${figureMax > 0 ? item.total / figureMax * 100 : 0}%` }}>
                      {item.segments.map((segment) => <span key={segment.venue} title={`${venueName(segment.venue)} · ${compactUsd(segment.value)}`} style={{ flex: segment.value, background: venueColour.get(segment.venue) }} />)}
                    </span>
                  </span>
                  <span className="p-mono p-hbar-val">{compactUsd(item.total)}</span>
                  <span className="p-mono p-faint p-hbar-pct">{share(item.total, figureTotal)}</span>
                </div>)}
              </div>
            </div>
            <div className="p-panel-foot"><span>Source: venue market data, {plural(totals.providers.length, "provider")}. This shows the current 30-day window; the daily series is on the Market Overview page (Figure 1).</span></div>
          </section>

          <section className="p-panel" aria-labelledby="p-t1">
            <PHead title="Data Providers" id="p-t1" aside="Every figure on this page is built from these feeds, read on each refresh." />
            <div className="p-scroll"><table className="p-table" style={{ minWidth: 1080 }}>
              <thead><tr><th>Provider</th><th>Companies covered</th><th className="r">Markets</th><th>Asset types</th><th>Venues</th><th className="r">30D volume</th><th className="r">Open interest</th><th className="r">Share</th><th className="r">Feed status</th></tr></thead>
              <tbody>{providers.map((provider) => <tr key={provider.name}>
                <td><span className="p-prov"><VenueLogo name={provider.name} size={26} /><strong>{provider.name}</strong></span></td>
                <td>{provider.companies.join(", ")}</td>
                <td className="r p-mono">{provider.rows.length}</td>
                <td><span className="p-prov">{provider.types.map((key) => <TypeTag key={key} type={key} />)}</span></td>
                <td>{provider.venues.join(", ")}</td>
                <td className="r p-mono">{compactUsd(provider.volume)}</td>
                <td className="r p-mono">{provider.oi ? compactUsd(provider.oi) : "—"}</td>
                <td className="r p-mono">{share(provider.volume, totals.volume30)}</td>
                <td className="r"><span className={`p-status ${provider.tone}`}><i />{provider.status}</span></td>
              </tr>)}</tbody>
            </table></div>
          </section>

          <section className="p-panel" aria-labelledby="p-t2">
            <PHead title="League Table" id="p-t2" aside="Ranked by 30-day volume · all asset types" />
            <div className="p-tabs" role="group" aria-label="Group by">
              {([["provider", "Data providers"], ["venue", "Venues"], ["company", "Companies"], ["type", "Asset types"]] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={league === key} onClick={() => setLeague(key)}>{label}</button>
              ))}
            </div>
            <div className="p-scroll"><table className="p-table" style={{ minWidth: 760 }}>
              <thead><tr><th style={{ width: 40 }}>#</th><th>{{ provider: "Provider", venue: "Venue", company: "Company", type: "Asset type" }[league]}</th><th className="r">Markets</th><th className="r">30D volume</th><th className="r">30D chg</th><th className="r">Open interest</th><th className="r">Market share</th></tr></thead>
              <tbody>{leagueRows.map((row, index) => <tr key={row.name}>
                <td className="p-mono p-faint">{index + 1}</td>
                <td><span className="p-prov">{(league === "provider" || league === "venue") && <VenueLogo name={row.name} size={20} />}<strong>{row.name}</strong></span></td>
                <td className="r p-mono">{row.count}</td>
                <td className="r p-mono">{compactUsd(row.volume)}</td>
                <td className="r p-mono p-flat">—</td>
                <td className="r p-mono">{row.oi ? compactUsd(row.oi) : "—"}</td>
                <td className="r"><span className="p-divcell"><PShare value={totals.volume30 > 0 ? row.volume / totals.volume30 : 0} width={96} /><span className="p-mono">{share(row.volume, totals.volume30)}</span></span></td>
              </tr>)}</tbody>
            </table></div>
          </section>

          <section className="p-trio">
            <div className="p-panel">
              <PHead title="30D Volume by Asset Type" />
              <div className="p-pad">
                <div className="p-sharebar tall" role="img" aria-label="30-day volume split by asset type">
                  {typeSplit.map((item) => <span key={item.key} style={{ flex: Math.max(item.volume / (totals.volume30 || 1) * 100, 0.6), background: TYPE_INFO[item.key].colour }} />)}
                </div>
                {typeSplit.map((item) => <div key={item.key} className="p-mix-row light">
                  <i style={{ background: TYPE_INFO[item.key].colour }} />
                  <span className="p-grow">{TYPE_INFO[item.key].name} <span className="p-faint">· {plural(item.count, "market")}</span></span>
                  <strong className="p-mono">{compactUsd(item.volume)}</strong>
                  <span className="p-mono p-mix-pct">{share(item.volume, totals.volume30)}</span>
                </div>)}
                {["SPV units", "Tokenized notes"].map((name) => <div key={name} className="p-mix-row light" style={{ opacity: 0.55 }}>
                  <i style={{ background: "var(--series-rest)" }} /><span className="p-grow">{name} <span className="p-faint">· not covered</span></span><strong className="p-mono">—</strong><span className="p-mono p-mix-pct">—</span>
                </div>)}
              </div>
            </div>
            <div className="p-panel">
              <PHead title="Perpetual Funding (APR)" aside="Top 8 by open interest" />
              <div className="p-pad p-bars">
                {fundBars.length ? fundBars.map((market) => {
                  const rate = market.fundingRateAnnualized!;
                  const width = Math.min(Math.abs(rate) / maxFund, 1) * 50;
                  return <div key={keyOf(market)} className="p-fund-row">
                    <span title={market.label} className="p-prov"><ExchangeMark provider={market.provider} venue={venueName(market.venue)} size={18} /><strong>{market.company.name}</strong> <span className="p-faint">{market.provider}</span></span>
                    <span className="p-fund-track"><span className={rate >= 0 ? "up" : "down"} style={{ left: `${rate >= 0 ? 50 : 50 - width}%`, width: `${width}%` }} /></span>
                    <PFund value={rate} />
                  </div>;
                }) : <PEmpty>No perp reports funding.</PEmpty>}
              </div>
            </div>
            <div className="p-panel">
              <PHead title="Largest Markets" aside="By 30D volume" />
              <div className="p-pad p-largest">
                {largest.map((market) => <Link key={keyOf(market)} href={`/company/${market.company.slug}`} className="p-largest-row">
                  <ExchangeMark provider={market.provider} venue={venueName(market.venue)} size={24} /><span className="p-grow"><strong>{market.company.name}</strong><small className="p-mono p-faint">{market.label} · {market.provider}</small></span>
                  <TypeTag type={market.marketType} />
                  <span className="p-mono">{compactUsd(market.volume30dUsd)}</span>
                </Link>)}
              </div>
            </div>
          </section>

          <section className="p-browser" aria-labelledby="p-t4">
            <aside className="p-panel p-side">
              <div className="p-side-group">
                <span className="p-lbl p-tip">Asset type<AssetTypeTip /></span>
                {(["all", "perp", "spot"] as const).map((key) => <button key={key} type="button" className="p-side-btn" aria-pressed={sideType === key} onClick={() => setSideType(key)}>
                  <span>{key !== "all" && <i className="p-dot" style={{ background: TYPE_INFO[key].colour }} />}{key === "all" ? "All types" : TYPE_INFO[key].name}</span>
                  <span className="p-mono">{key === "all" ? markets.length : count((market) => market.marketType === key)}</span>
                </button>)}
              </div>
              <div className="p-side-group">
                <span className="p-lbl">Data provider</span>
                {["all", ...totals.providers].map((name) => <button key={name} type="button" className="p-side-btn" aria-pressed={sideProvider === name} onClick={() => setSideProvider(name)}>
                  <span>{name === "all" ? "All providers" : name}</span><span className="p-mono">{name === "all" ? markets.length : count((market) => market.provider === name)}</span>
                </button>)}
              </div>
              <div className="p-side-group">
                <span className="p-lbl">Sector</span>
                {["all", ...sectors].map((name) => <button key={name} type="button" className="p-side-btn" aria-pressed={sideSector === name} onClick={() => setSideSector(name)}>
                  <span>{name === "all" ? "All sectors" : name}</span><span className="p-mono">{name === "all" ? markets.length : count((market) => market.company.sector === name)}</span>
                </button>)}
              </div>
              <div className="p-side-group">
                <span className="p-lbl">Venue</span>
                <div className="p-chips">
                  {["all", ...totals.venues].map((name) => <button key={name} type="button" className="p-chip" aria-pressed={sideVenue === name} onClick={() => setSideVenue(name)}>{name === "all" ? "All" : venueName(name)}</button>)}
                </div>
              </div>
              <div className="p-side-group">
                <label className="p-check"><span>Active in last 24h only</span><input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} /></label>
                <label className="p-check"><span>Main price basis only</span><input type="checkbox" checked={basisOnly} onChange={(event) => setBasisOnly(event.target.checked)} /></label>
              </div>
            </aside>

            <div className="p-panel p-browser-main">
              <PHead title={<>All Pre-IPO Markets <span className="p-mono p-faint">({sorted.length})</span></>} id="p-t4">
                <button type="button" className="p-btn p-btn-outline p-btn-sm" onClick={() => csv(sorted)} disabled={!sorted.length}><Download size={13} />Export CSV</button>
              </PHead>
              <div className="p-scroll"><table className="p-table" style={{ minWidth: 1160 }}>
                <thead><tr>
                  <th style={{ width: 36 }}>#</th><th>Company / pair</th><th>Exchange</th><th>Type</th>
                  {([["price", "Quote"], ["premium", "vs off-chain"], ["volume30dUsd", "30D Vol"], ["chg30", "30D Chg"], ["openInterestUsd", "Open Int."], ["fundingRateAnnualized", "Funding"]] as const).map(([key, label]) => (
                    <th key={key} className="r" aria-sort={sort === key ? direction < 0 ? "descending" : "ascending" : "none"}>
                      <button type="button" className="p-sort" data-on={sort === key} onClick={() => toggleSort(key)}>{label}{sort === key ? direction < 0 ? " ↓" : " ↑" : ""}</button>
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {shown.map((market, index) => <tr key={keyOf(market)} className={market.offBasis ? "p-off" : undefined}>
                    <td className="p-mono p-faint">{index + 1}</td>
                    <td><Link href={`/company/${market.company.slug}`} className="p-co-link"><strong>{market.company.name}</strong><small className="p-mono p-faint">{market.label}{market.offBasis ? " · other basis" : ""}</small></Link></td>
                    <td>{market.issuer ? <Exchange provider={market.provider} venue={null} sub={`on ${market.issuer.chain}`} /> : <Exchange provider={market.provider} venue={venueName(market.venue)} />}</td>
                    <td><TypeTag type={market.marketType} /></td>
                    <td className="r p-mono">{market.issuer && market.tradeUrl
                      ? <a className="p-ext" href={market.tradeUrl} target="_blank" rel="noopener noreferrer" aria-label={`${marketPrice(market.price)} on ${market.provider}, opens in a new tab`}>{marketPrice(market.price)}</a>
                      : <Flash value={market.price}>{marketPrice(market.price)}</Flash>}</td>
                    <td className="r">{market.marketType === "spot" ? <PPremium value={spotPremium(market.price, market.company)} /> : <span className="p-faint">—</span>}</td>
                    <td className="r p-mono">{compactUsd(market.volume30dUsd)}</td>
                    <td className="r"><PChg value={marketChange(market)} /></td>
                    <td className="r p-mono">{compactUsd(market.openInterestUsd)}</td>
                    <td className="r"><PFund value={market.fundingRateAnnualized} /></td>
                  </tr>)}
                  {!shown.length && <tr><td colSpan={10}><PEmpty>No markets match these filters.</PEmpty></td></tr>}
                </tbody>
              </table></div>
              {sorted.length > PAGE && <div className="p-panel-foot center">
                <button type="button" className="p-btn p-btn-ghost p-btn-sm" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show fewer" : `Show all ${sorted.length} markets`}</button>
              </div>}
            </div>
          </section>

          <section className="p-notes">
            <div><span className="p-lbl">Notes</span>¹ 30D prior comparisons need stored snapshots and show — until the API keeps them. ² Open interest covers perpetual markets only. 30D change is shown only for each company&apos;s lead market, the one whose daily closes are read.</div>
            <div><span className="p-lbl">Methodology</span>Volumes, open interest and funding are as reported by each venue and aggregated without adjustment. Fees are 30-day volume at each venue&apos;s base taker rate, an upper bound. Markets quoting a different unit basis are flagged and kept out of medians.</div>
            <div><span className="p-lbl">Disclosures</span>For information only; not an offer or solicitation. Perpetual futures and synthetic products do not confer ownership of company shares. Availability depends on jurisdiction and investor eligibility.</div>
          </section>
        </>}
    </main>
  </ProShell>;
}
