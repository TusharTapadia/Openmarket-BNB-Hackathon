"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Star } from "lucide-react";
import { MarketHeader } from "@/components/market-header";
import { IST } from "@/components/market-ticker";
import { DataState } from "@/components/data-state";
import { Flash } from "@/components/flash";
import { Skeleton, SkeletonInline, SkeletonLines, SkeletonList, useCrosshair } from "@/components/skeleton";
import { COVERAGE_COMPANIES } from "@/lib/market-coverage/shared";
import { InfoTip } from "@/components/info-tip";
import { ChangeBadge, DivBar, Mark, Pct, Spark } from "@/components/pc";
import { useRemoteData } from "@/hooks/use-market-data";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useViewMode } from "@/components/view-mode";
import { ProHome } from "@/components/pro/pro-home";
import { MarketSummary } from "@/components/market-summary";
import { HEAT_MAP_ENABLED, HeatMap } from "@/components/heat-map";
import { CompanyCarousel } from "@/components/company-carousel";
import { ValuationCalculator } from "@/components/valuation-calculator";
import { compactUsd, companyView, fundingText, plural, TYPE_INFO, type AssetType, type CompanyView, type CoveragePayload } from "@/lib/coverage-view";
import type { IpoOdds } from "@/lib/ipo-odds";
import { changeOver, formatPrice, formatSignedPercent } from "./data";

type SortKey = "name" | "price" | "change24h" | "change7d" | "valuation" | "premium" | "volume" | "openInterest";

const WATCHLIST = "Watchlist";
const ALL = "All";
const DAY = 1;
const WEEK = 7;

function sortValue(company: CompanyView, key: SortKey): number | string | null {
  switch (key) {
    case "name": return company.name;
    case "price": return company.offchainPrice;
    case "change24h": return changeOver(company.history, DAY);
    case "change7d": return changeOver(company.history, WEEK);
    case "valuation": return company.offchainValuation;
    case "premium": return company.premium;
    case "volume": return company.totals.volume24hUsd;
    case "openInterest": return company.totals.openInterestUsd;
  }
}

const COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
  { key: "price", label: "Price", hint: "Off-chain price for one share, from private-market transactions. Under it, the share price the markets imply (implied valuation ÷ total shares). Perp prices themselves are not share prices." },
  { key: "change24h", label: "24h", hint: "Change in the daily close of the company's most-traded market." },
  { key: "change7d", label: "7d", hint: "Change in the daily close of the company's most-traded market over seven days." },
  { key: "valuation", label: "Valuation", hint: "Off-chain valuation of the whole company. Under it, the valuation the markets imply, from contracts whose price basis is confirmed." },
  { key: "premium", label: "vs off-chain", hint: "Market-implied valuation against the off-chain valuation. Positive means the markets value the company above it. Shown only where a contract's price basis is confirmed." },
  { key: "volume", label: "Volume", hint: "Traded across every market in the last 24 hours, with the 30-day total under it." },
  { key: "openInterest", label: "Open interest", hint: "Value of open perpetual positions across every venue that reports it, with open-interest-weighted funding (APR) under it." },
];

/** Columns that give way, narrowest screens first, so the table fits instead of scrolling. */
const PLACEHOLDER_ROWS = [0, 1, 2, 3, 4];

const COLUMN_CLASS: Partial<Record<SortKey, string>> = {
  change24h: "pc-col-24h",
  valuation: "pc-col-valuation",
  premium: "pc-col-premium",
  volume: "pc-col-volume",
  openInterest: "pc-col-oi",
};

type Period = "24h" | "30d";

/** Lite or Pro, by the reader's saved choice. */
export default function Home() {
  return useViewMode().mode === "pro" ? <ProHome /> : <LiteHome />;
}

function LiteHome() {
  const { data, loading, error, refreshing, refresh } = useRemoteData<CoveragePayload>("/api/coverage", true);
  const { data: odds } = useRemoteData<Record<string, IpoOdds>>("/api/ipo-odds", true);
  const { watchlist, toggleWatch } = useWatchlist();
  const tableSkeleton = useCrosshair(loading);
  const [sector, setSector] = useState<string>(ALL);
  const [type, setType] = useState<AssetType | "all">("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("valuation");
  const [direction, setDirection] = useState(-1);
  const [period, setPeriod] = useState<Period>("30d");

  useEffect(() => {
    const sync = () => setSector(new URLSearchParams(window.location.search).get("view") === "watchlist" ? WATCHLIST : ALL);
    // Restore the bookmarked view after hydration.
    const timer = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, []);

  function pickSector(next: string) {
    setSector(next);
    window.history.replaceState(null, "", next === WATCHLIST ? "/?view=watchlist" : "/");
  }

  const companies = useMemo(() => (data?.companies ?? []).map(companyView), [data]);
  const sectors = useMemo(() => [...new Set(companies.flatMap((company) => company.sector ? [company.sector] : []))].sort(), [companies]);

  // Ranked once by off-chain valuation, so the number is a company's standing
  // rather than its position in whatever the reader has filtered down to.
  const ranks = useMemo(() => new Map(
    [...companies].sort((a, b) => (b.offchainValuation ?? 0) - (a.offchainValuation ?? 0)).map((company, index) => [company.slug, index + 1]),
  ), [companies]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return companies.filter((company) => {
      if (sector === WATCHLIST && !watchlist.includes(company.slug)) { return false; }
      if (sector !== ALL && sector !== WATCHLIST && company.sector !== sector) { return false; }
      if (type !== "all" && !company.types.includes(type)) { return false; }
      return !query || `${company.name} ${company.sector ?? ""}`.toLowerCase().includes(query);
    });
  }, [companies, search, sector, type, watchlist]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const left = sortValue(a, sort);
    const right = sortValue(b, sort);
    if (left === null && right === null) { return a.name.localeCompare(b.name); }
    if (left === null) { return 1; }
    if (right === null) { return -1; }
    return direction * (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right)));
  }), [filtered, sort, direction]);

  function toggleSort(key: SortKey) {
    if (key === sort) { setDirection((value) => -value); }
    else { setSort(key); setDirection(key === "name" ? 1 : -1); }
  }

  const total = (pick: (company: CompanyView) => number) => companies.reduce((sum, company) => sum + pick(company), 0);
  const volume24 = total((company) => company.totals.volume24hUsd);
  const volume30 = total((company) => company.totals.volume30dUsd);
  const openInterest = total((company) => company.totals.openInterestUsd);
  const offchainTotal = total((company) => company.offchainValuation ?? 0);
  const marketCount = total((company) => company.rows.length);
  const venueCount = new Set(companies.flatMap((company) => company.venues)).size;
  const maxPremium = Math.max(0, ...companies.map((company) => Math.abs(company.premium ?? 0)));

  // Hero: how the chosen period's volume splits across the companies.
  const periodVolume = (company: CompanyView) => period === "24h" ? company.totals.volume24hUsd : company.totals.volume30dUsd;
  const periodTotal = period === "24h" ? volume24 : volume30;
  const byVolume = [...companies].sort((a, b) => periodVolume(b) - periodVolume(a));
  // Every IPO bar shares one scale: today to the furthest deadline any ladder prices.
  const ipoScale = Math.max(1, ...Object.values(odds ?? {}).map((entry) => daysUntil(entry.latest)));
  const SHADES = ["var(--series-1)", "var(--series-2)", "var(--series-8)", "var(--series-3)"];

  // Dark card: the last day's volume by asset type.
  const typeMix = (["perp", "spot"] as const).map((key) => {
    const rows = companies.flatMap((company) => company.rows.filter((row) => row.marketType === key));
    return { key, count: rows.length, volume: rows.reduce((sum, row) => sum + (row.volume24hUsd ?? 0), 0) };
  }).filter((item) => item.count > 0);

  // OpenStocks, PreStocks and xStocks tokens: spot assets priced by their issuer, with no venue volume.
  const issuerCount = companies.reduce((sum, company) => sum + company.issuers.length, 0);
  const mostTraded = [...companies].sort((a, b) => b.totals.volume30dUsd - a.totals.volume30dUsd).filter((company) => company.totals.volume30dUsd > 0).slice(0, 4);
  const byValuation = [...companies].sort((a, b) => (b.offchainValuation ?? 0) - (a.offchainValuation ?? 0));

  const sectorCount = (value: string) => value === ALL ? companies.length
    : value === WATCHLIST ? companies.filter((company) => watchlist.includes(company.slug)).length
    : companies.filter((company) => company.sector === value).length;
  const activeFilters = search.trim() !== "" || sector !== ALL || type !== "all";
  function resetFilters() { setSearch(""); pickSector(ALL); setType("all"); }

  const refreshedAt = data ? IST.format(new Date(data.updatedAt)) : null;

  return <div className="app-shell">
    <MarketHeader
      view={sector === WATCHLIST ? "watchlist" : "markets"}
      onView={(next) => pickSector(next === "watchlist" ? WATCHLIST : ALL)}
      search={{ value: search, onChange: setSearch }}
    />

    <main className="pc-page">
      {error && data && <div className="pc-notice" role="alert">{error} Showing the last successful fetch.</div>}

      <section className="mk-surface mk-intro" aria-labelledby="intro-h">
        <div className="mk-intro-lead">
          <h1 id="intro-h">Pre-IPO markets</h1>
          <p>Prices for private companies, read from off-chain trades and from the perpetual and spot markets that track them.</p>
        </div>
        <dl className="mk-term"><dt>Off-chain price</dt><dd>The price of one share from private-market transactions. It anchors every valuation on this page.</dd></dl>
        <dl className="mk-term"><dt>Perpetuals and spot tokens</dt><dd>Perps are cash-settled bets on what a company is worth, not shares. Spot tokens are issued to track a share.</dd></dl>
        <dl className="mk-term"><dt>Implied valuation</dt><dd>What the markets price the whole company at. Above off-chain means traders value it higher.</dd></dl>
      </section>

      <section className="pc-overview mk-compact" aria-label="Market overview">
        <div className="pc-card pc-hero">
          <div className="pc-hero-top">
            <div className="pc-hero-figures">
              <span className="pc-label"><span className="pc-dot" style={{ background: "var(--up-bar)" }} />Pre-IPO markets · {period === "24h" ? "24-hour" : "30-day"} volume</span>
              <div className="pc-hero-line">
                <span className="pc-hero-value">{loading ? <SkeletonInline width={160} height={32} /> : compactUsd(periodTotal)}</span>
                {!loading && offchainTotal > 0 && <span className="pc-badge flat">{compactUsd(offchainTotal)} off-chain value</span>}
              </div>
              <span className="pc-hero-sub">
                {loading ? <SkeletonInline width={320} height={14} /> : `${plural(companies.length, "company")}, ${plural(marketCount, "market")} on ${plural(venueCount, "venue")}, ${compactUsd(openInterest)} open interest`}
              </span>
              <p className="mk-note">Money traded across every market, split by company below. The IPO bar runs to the date Kalshi traders give even odds of the S-1 going effective, then on to the latest deadline they price.</p>
            </div>
            <div className="pc-segment" role="group" aria-label="Volume period">
              {(["24h", "30d"] as const).map((item) => (
                <button key={item} type="button" className="pc-seg" aria-pressed={period === item} onClick={() => setPeriod(item)}>{item.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {loading ? <div className="mk-hero-body mk-hero-loading">
              {/* One placeholder row per covered company, so the list keeps its height when the data lands. */}
              <Skeleton height={10} radius={2} />
              <SkeletonList rows={COVERAGE_COMPANIES.length} label="Loading market volume" mark={30} />
            </div>
            : periodTotal > 0 ? <div className="mk-hero-body">
              <div className="pc-share-bar" style={{ height: 14 }} role="img" aria-label={`${period} volume split by company`}>
                {byVolume.filter((company) => periodVolume(company) > 0).map((company, index) => (
                  <span key={company.slug} style={{ flex: Math.max(periodVolume(company) / periodTotal * 100, 0.6), background: SHADES[index % SHADES.length] }} title={`${company.name} · ${compactUsd(periodVolume(company))}`} />
                ))}
              </div>
              <div className="mk-hero-rows">
                {byVolume.map((company, index) => {
                  const share = periodTotal > 0 ? periodVolume(company) / periodTotal : 0;
                  return <Link key={company.slug} href={`/company/${company.slug}`} className="pc-list-row">
                    <span className="pc-dot" style={{ background: SHADES[index % SHADES.length] }} />
                    <Mark name={company.name} logo={company.logo} size={30} />
                    <span className="pc-list-name">{company.name}</span>
                    <IpoTrack listed={company.listed?.since ?? null} odds={odds?.[company.slug] ?? null} scale={ipoScale} />
                    <span className="pc-cell-sub mk-markets-cell">{plural(company.rows.length, "market")}</span>
                    <span className="pc-sharebar"><span style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }} /></span>
                    <span className="mk-volume-cell">{compactUsd(periodVolume(company))}</span>
                    <span className="mk-share-cell">{share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`}</span>
                  </Link>;
                })}
              </div>
            </div>
            : <div className="pc-hero-empty">{error ? "Market data is unavailable right now." : "No volume reported in this period."}</div>}
        </div>

        <div className="pc-side">
          <div className="pc-dark">
            <div className="mk-dark-top">
              <span className="pc-label">24h volume by asset type</span>
              <span className="pc-dark-value">{loading ? <SkeletonInline width={88} height={19} /> : compactUsd(volume24)}</span>
            </div>
            {typeMix.length > 0 && volume24 > 0 ? <>
              <div className="pc-mix-bar" role="img" aria-label="24-hour volume split by asset type">
                {typeMix.map((item) => <span key={item.key} style={{ flex: Math.max(item.volume / volume24 * 100, 0.5), background: TYPE_INFO[item.key].colour }} />)}
              </div>
              <div className="pc-mix-rows">
                {typeMix.map((item) => {
                  const share = item.volume / volume24 * 100;
                  return <div key={item.key} className="pc-mix-row">
                    <span className="pc-dot" style={{ background: TYPE_INFO[item.key].colour }} />
                    <span className="name">{TYPE_INFO[item.key].name} <em>· {plural(item.count, "market")}{item.key === "spot" && issuerCount ? `, ${plural(issuerCount, "issuer token")}` : ""}</em></span>
                    <strong>{compactUsd(item.volume)}</strong>
                    <span className="pct">{share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`}</span>
                  </div>;
                })}
              </div>
            </> : loading ? <SkeletonLines lines={2} label="Loading volume by asset type" /> : <span className="pc-mix-row">No volume reported.</span>}
          </div>

          <div className="pc-card pc-list-card">
            <div className="pc-list-head">
              <span className="pc-label">Off-chain prices</span>
              {data?.offchainAsOf && <span className="pc-cell-sub">as of {IST.format(new Date(data.offchainAsOf))} IST</span>}
            </div>
            <div className="mk-offchain-cols" aria-hidden><span>Company</span><span>Share price</span><span>Valuation</span></div>
            {byValuation.length ? byValuation.map((company) => (
              <Link key={company.slug} className="pc-list-row" href={`/company/${company.slug}`}>
                <Mark name={company.name} logo={company.logo} size={30} />
                <span className="pc-list-name">{company.name}</span>
                <span className="pc-cell-main mk-oc-price">{formatPrice(company.offchainPrice)}</span>
                <span className="pc-cell-sub mk-oc-val" aria-label={`${compactUsd(company.offchainValuation)} valuation`}>{compactUsd(company.offchainValuation)}</span>
              </Link>
            )) : loading ? <SkeletonList rows={COVERAGE_COMPANIES.length} label="Loading off-chain prices" mark={30} /> : <p className="pc-list-empty">Off-chain prices are unavailable right now.</p>}
          </div>
        </div>
      </section>

      <section className="pc-card pc-table-card" aria-labelledby="markets-h">
        <div className="pc-table-head">
          <div>
            <h2 id="markets-h" className="pc-h2">{sector === WATCHLIST ? "Your watchlist" : "All companies"}</h2>
            <p className="mk-note">One row per company. Sort by any column; the <strong>(i)</strong> beside a heading explains it. Star a row to keep it in your watchlist.</p>
          </div>
          <div className="pc-segment" role="group" aria-label="Sector">
            {[ALL, ...sectors, WATCHLIST].map((item) => (
              <button key={item} type="button" className="pc-seg" aria-pressed={sector === item} onClick={() => pickSector(item)}>
                {item}{!loading && <span className="pc-seg-count">{sectorCount(item)}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="pc-filter-row">
          <span className="pc-label pc-label-strong pc-th-inner">Asset type<InfoTip label="Asset types">
            Perpetuals are cash-settled contracts on what traders expect the company to be worth, not shares. Most pre-IPO perps quote the company valuation divided by a notional share count (Binance&apos;s OpenAI contract uses 1 billion), so a $1,228 OpenAI perp means about a $1.23T valuation, not a $1,228 share. A few quote one share instead (trade.xyz&apos;s ANT). Compare perps on implied valuation, not price. Spot tokens are issuer tokens that track a share.
          </InfoTip></span>
          {([["all", "All types", "var(--series-rest)"], ["perp", TYPE_INFO.perp.name, TYPE_INFO.perp.colour], ["spot", TYPE_INFO.spot.name, TYPE_INFO.spot.colour]] as const).map(([key, label, colour]) => (
            <button key={key} type="button" className="pc-chip" aria-pressed={type === key} onClick={() => setType(key)}>
              <span className="pc-dot" style={{ background: colour }} />{label}
            </button>
          ))}
          <span className="pc-spacer" />
          {activeFilters && <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={resetFilters}>Reset filters</button>}
        </div>

        {error && !data && !loading ? <DataState error title="Market data unavailable" description={error} action={refresh} />
          : loading || sorted.length ? <div className="pc-scroll" ref={tableSkeleton}>
            <table className="pc-table pc-table-fit">
              <caption className="sr-only">Off-chain prices and valuations, with volume, open interest and funding across every market that trades each company.</caption>
              <thead><tr>
                <th style={{ width: 36 }} aria-label="Watchlist" />
                <th style={{ width: 28 }}>#</th>
                <th aria-sort={sort === "name" ? direction === -1 ? "descending" : "ascending" : "none"}>
                  <button type="button" className={`pc-sort ${sort === "name" ? "on" : ""}`} onClick={() => toggleSort("name")}>Company · markets<span aria-hidden>{sort === "name" ? direction < 0 ? "↓" : "↑" : ""}</span></button>
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={`r ${COLUMN_CLASS[column.key] ?? ""}`} aria-sort={sort === column.key ? direction === -1 ? "descending" : "ascending" : "none"}>
                    <span className="pc-th-inner">
                      <button type="button" className={`pc-sort ${sort === column.key ? "on" : ""}`} onClick={() => toggleSort(column.key)}>
                        {column.label}<span aria-hidden>{sort === column.key ? direction < 0 ? "↓" : "↑" : ""}</span>
                      </button>
                      {column.hint && <InfoTip label={column.label}>{column.hint}</InfoTip>}
                    </span>
                  </th>
                ))}
                <th className="r pc-col-trend">7D trend</th>
              </tr></thead>
              <tbody>{loading ? PLACEHOLDER_ROWS.map((row) => <tr key={row}>
                <td><span className="pc-star" /></td>
                <td className="pc-rank">—</td>
                <td><span className="pc-co"><span className="pc-mark s38" /><span className="pc-co-text"><span className="pc-co-line"><span className="pc-co-name">Company name</span></span><span className="pc-co-meta">— markets · — venues</span></span></span></td>
                {COLUMNS.map((column) => <td key={column.key} className={`r ${COLUMN_CLASS[column.key] ?? ""}`}><span className="pc-cell-stack"><span className="pc-cell-main">—</span><span className="pc-cell-sub">—</span></span></td>)}
                <td className="r pc-col-trend"><span className="pc-cell-sub">—</span></td>
              </tr>) : sorted.map((company) => {
                const watched = watchlist.includes(company.slug);
                return <tr key={company.slug}>
                  <td>
                    <button type="button" className="pc-star" onClick={() => toggleWatch(company.slug)} aria-pressed={watched}
                      aria-label={`${watched ? "Remove" : "Add"} ${company.name} ${watched ? "from" : "to"} watchlist`}>
                      <Star size={17} fill={watched ? "currentColor" : "none"} strokeWidth={1.75} />
                    </button>
                  </td>
                  <td className="pc-rank">{ranks.get(company.slug)}</td>
                  <td>
                    <Link className="pc-co" href={`/company/${company.slug}`}>
                      <Mark name={company.name} logo={company.logo} size={38} />
                      <span className="pc-co-text">
                        <span className="pc-co-name">{company.name}</span>
                        {company.sector && <span className="pc-co-sector">{company.sector}</span>}
                        <span className="pc-co-meta">
                          {plural(company.rows.length, "market")} · {plural(company.venues.length, "venue")}
                          {company.types.map((key) => <span key={key} className={`pc-tag ${TYPE_INFO[key].tagClass}`}>{TYPE_INFO[key].tag}</span>)}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="r"><span className="pc-cell-stack"><Flash value={company.listed ? company.impliedSharePrice : company.offchainPrice} className="pc-cell-main"><span style={{ fontSize: 15 }}>{formatPrice(company.listed ? company.impliedSharePrice : company.offchainPrice)}</span></Flash><span className="pc-cell-sub">{company.listed ? `Listed · ${company.listed.ticker}` : <>implied <Flash value={company.impliedSharePrice}>{formatPrice(company.impliedSharePrice)}</Flash></>}</span></span></td>
                  <td className="r pc-col-24h"><Pct value={changeOver(company.history, DAY)} /></td>
                  <td className="r"><Pct value={changeOver(company.history, WEEK)} /></td>
                  <td className="r pc-col-valuation"><span className="pc-cell-stack"><span className="pc-cell-main">{compactUsd(company.offchainValuation)}</span>
                    <span className="pc-cell-sub">{company.listed ? (company.offchainValuationBasis === "price × shares" ? "price × shares" : "last pre-IPO") : `implied ${compactUsd(company.impliedValuation)}`}</span></span></td>
                  <td className="r pc-col-premium">{company.premium === null ? <span className="pc-pct pc-flat">{company.listed ? "Listed" : "—"}</span>
                    : <span className="pc-divbar-cell"><DivBar value={company.premium} max={maxPremium} /><span className={`pc-divbar-val ${company.premium >= 0 ? "pc-up" : "pc-down"}`}>{formatSignedPercent(company.premium)}</span></span>}</td>
                  <td className="r pc-col-volume"><span className="pc-cell-stack"><span className="pc-cell-main" style={{ fontSize: 14 }}>{compactUsd(company.totals.volume24hUsd)}</span>
                    <span className="pc-cell-sub">30d {compactUsd(company.totals.volume30dUsd)}</span></span></td>
                  <td className="r pc-col-oi"><span className="pc-cell-stack"><span className="pc-cell-main" style={{ fontSize: 14 }}>{company.totals.openInterestUsd ? compactUsd(company.totals.openInterestUsd) : "—"}</span>
                    <span className="pc-cell-sub">funding {fundingText(company.funding)}</span></span></td>
                  <td className="r pc-col-trend"><Spark width={72} values={company.history} label={`${company.name} market price, last ${company.history.length} days`} /></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          : <div className="pc-empty">
            <p>{sector === WATCHLIST && !watchlist.length ? "Star a company to add it to your watchlist." : "No companies match these filters."}</p>
            <button type="button" className="pc-btn pc-btn-outline pc-btn-sm" onClick={resetFilters}>{sector === WATCHLIST && !watchlist.length ? "Browse companies" : "Clear filters"}</button>
          </div>}

        <div className="pc-table-foot">
          <span>{loading ? <SkeletonInline width={240} /> : `Showing ${sorted.length} of ${plural(companies.length, "company")} · price is off-chain; market price is the median across markets on the main price basis`}</span>
          <span>Funding is open-interest weighted across perp markets.</span>
        </div>
      </section>

      {mostTraded.length > 0 && <section aria-labelledby="movers-h" className="mk-movers-section">
        <div className="pc-section-head">
          <div>
            <h2 id="movers-h" className="pc-h2">Most traded</h2>
            <p className="mk-note">The four companies with the most 30-day volume. The badge is the last day&apos;s move; the line is the recent price path.</p>
          </div>
          <span>By 30-day volume across all markets</span>
        </div>
        <div className="pc-movers">
          {mostTraded.map((company) => (
            <Link key={company.slug} className="pc-mover" href={`/company/${company.slug}`}>
              <div className="pc-mover-head">
                <Mark name={company.name} logo={company.logo} size={32} />
                <div className="pc-mover-id">
                  <strong>{company.name}</strong>
                  <small>{compactUsd(company.totals.volume30dUsd)} 30d · {plural(company.rows.length, "market")}</small>
                </div>
                <ChangeBadge value={changeOver(company.history, DAY)} />
              </div>
              <div className="pc-mover-foot">
                <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <Flash value={company.offchainPrice} className="pc-mover-price">{formatPrice(company.offchainPrice)}</Flash>
                  <span className="pc-cell-sub">{company.listed ? `Listed · ${company.listed.exchange} ${company.listed.ticker}` : `implied ${compactUsd(company.impliedValuation)}${company.premium !== null ? ` · ${formatSignedPercent(company.premium)}` : ""}`}</span>
                </span>
                <Spark values={company.history} width={104} height={36} label={`${company.name} market price, last ${company.history.length} days`} />
              </div>
            </Link>
          ))}
        </div>
      </section>}

      <MarketSummary companies={companies} loading={loading} variant="lite" />

      {HEAT_MAP_ENABLED && <HeatMap companies={companies} loading={loading} variant="lite" />}

      <CompanyCarousel companies={companies} loading={loading} />

      <ValuationCalculator />
    </main>

    <footer className="pc-footer">
      <div className="pc-footer-inner">
        <span className="pc-footer-status">
          <span className="pc-dot" style={{ background: error ? "var(--down-bar)" : "var(--up-bar)" }} />
          {refreshedAt ? `Markets read ${refreshedAt} IST` : <SkeletonInline width={120} />}
          <button type="button" onClick={refresh} disabled={refreshing}><RefreshCw size={13} className={refreshing ? "spinning" : ""} />Refresh</button>
        </span>
      </div>
    </footer>
  </div>;
}

const DAY_MS = 86_400_000;
const daysUntil = (iso: string) => Math.max(0, Math.round((Date.parse(iso) - Date.now()) / DAY_MS));
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/**
 * Days to the expected S-1, then on to the latest deadline priced, on a scale
 * shared by every row. Solid: today to even odds. Light: even odds to the last rung.
 */
function IpoTrack({ listed, odds, scale }: { listed: string | null; odds: IpoOdds | null; scale: number }) {
  if (listed) {
    return <span className="mk-ipo is-listed" title={`Listed ${shortDate(listed)}`}>
      <span className="mk-ipo-bar"><span className="mk-ipo-done" style={{ width: "100%" }} /></span>
      <span className="mk-ipo-text">Listed</span>
    </span>;
  }
  if (!odds) {
    return <span className="mk-ipo is-none" title="No Kalshi IPO market for this company">
      <span className="mk-ipo-bar" />
      <span className="mk-ipo-text">No IPO market</span>
    </span>;
  }
  const latest = daysUntil(odds.latest);
  const expected = odds.expected ? daysUntil(odds.expected) : null;
  const pct = (days: number) => `${Math.min(100, days / scale * 100)}%`;
  const odd = `${Math.round(odds.latestOdds * 100)}%`;
  const title = expected !== null
    ? `S-1 expected ${shortDate(odds.expected!)} (${expected} days, 50% odds on Kalshi). Latest deadline priced: ${shortDate(odds.latest)} (${latest} days, ${odd} odds).`
    : `Kalshi odds never reach 50%: ${odd} the S-1 is effective by ${shortDate(odds.latest)} (${latest} days).`;
  return <span className="mk-ipo" title={title} aria-label={title}>
    <span className="mk-ipo-bar">
      {expected !== null && <span className="mk-ipo-done" style={{ width: pct(expected) }} />}
      <span className={expected !== null ? "mk-ipo-max" : "mk-ipo-max is-unlikely"} style={{ left: expected !== null ? pct(expected) : "0%", width: `calc(${pct(latest)} - ${expected !== null ? pct(expected) : "0%"})` }} />
    </span>
    <span className="mk-ipo-text">{expected !== null ? <>S-1 {expected}d <em>max {latest}d</em></> : <>{odd} by {latest}d</>}</span>
  </span>;
}
