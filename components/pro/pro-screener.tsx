"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { formatPrice, formatSignedPercent } from "@/app/data";
import { useWatchlist } from "@/hooks/use-watchlist";
import { DataState } from "@/components/data-state";
import { Mark } from "@/components/pc";
import { compactUsd, fundingText, plural, TYPE_INFO, type AssetType, type CompanyView } from "@/lib/coverage-view";
import { AssetTypeTip, fullUsd, ListedBadge, sharePrice, valuationBasis, monthYear, PChg, PDivBar, PEmpty, PHead, seriesChange, share, TypeTag, useLastRounds, useProData, venueName } from "./pro-kit";
import { PSpark, RebasedChart } from "./pro-charts";
import { ProShell } from "./pro-shell";
import { Flash } from "@/components/flash";
import { SkeletonChart, SkeletonList } from "@/components/skeleton";

/**
 * Pro screener: the "markets screener" artboard at institutional density.
 * Overview strip (rebased price chart, volume by asset type, round pipeline),
 * most-traded cards, then a wider company table than Lite's.
 */

type Period = 7 | 30 | 90;
type SortKey = "name" | "price" | "c24" | "c7" | "c30" | "valuation" | "vsRound" | "premium" | "volume" | "openInterest" | "fees";

const LINE_COLOURS = ["#0f1a2b", "#1f87dd", "#f29d12", "#1fbf6c", "#5a4632", "#9ca3af"];
const WATCHLIST = "Watchlist";
const ALL = "All";

const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "price", label: "Share price", title: "Off-chain price per share (for a listed company, the market-implied share price); the market-implied share price is under it." },
  { key: "c24", label: "24h", title: "Change in the lead market's daily close." },
  { key: "c7", label: "7d" },
  { key: "c30", label: "30d" },
  { key: "valuation", label: "Valuation", title: "Off-chain valuation; the market-implied valuation is under it." },
  { key: "vsRound", label: "vs last round", title: "Off-chain valuation against the last priced round (the round valuation is under it)." },
  { key: "premium", label: "vs off-chain", title: "Implied valuation vs off-chain valuation. — where no market's price basis is confirmed." },
  { key: "volume", label: "Volume", title: "24-hour volume; 30-day under it." },
  { key: "openInterest", label: "Open int.", title: "Perp open interest; OI-weighted funding APR under it." },
  { key: "fees", label: "Fees 30d", title: "Estimated at each venue's base taker fee: an upper bound." },
];

export function ProScreener() {
  const data = useProData();
  const { companies, totals, loading, error, refresh } = data;
  const { watchlist, toggleWatch } = useWatchlist();
  const rounds = useLastRounds(useMemo(() => companies.map((company) => company.slug), [companies]));
  const [period, setPeriod] = useState<Period>(30);
  const [sector, setSector] = useState(ALL);
  const [type, setType] = useState<AssetType | "all">("all");
  const [venue, setVenue] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [direction, setDirection] = useState(-1);

  // Same bookmarkable watchlist view as Lite.
  useEffect(() => {
    const sync = () => setSector(new URLSearchParams(window.location.search).get("view") === "watchlist" ? WATCHLIST : ALL);
    const timer = setTimeout(sync, 0);
    window.addEventListener("popstate", sync);
    return () => { clearTimeout(timer); window.removeEventListener("popstate", sync); };
  }, []);
  function pickSector(next: string) {
    setSector(next);
    window.history.replaceState(null, "", next === WATCHLIST ? "/screener?view=watchlist" : "/screener");
  }

  const vsRound = (company: CompanyView) => {
    const round = rounds[company.slug];
    return round && company.offchainValuation ? company.offchainValuation / round.valuation - 1 : null;
  };
  const value = (company: CompanyView, key: SortKey): number | string | null => {
    switch (key) {
      case "name": return company.name;
      case "price": return sharePrice(company);
      case "c24": return seriesChange(company, 1);
      case "c7": return seriesChange(company, 7);
      case "c30": return seriesChange(company, 30);
      case "valuation": return company.offchainValuation;
      case "vsRound": return vsRound(company);
      case "premium": return company.premium;
      case "volume": return company.totals.volume24hUsd;
      case "openInterest": return company.totals.openInterestUsd;
      case "fees": return company.totals.estFees30dUsd;
    }
  };

  const sectors = [...new Set(companies.flatMap((company) => company.sector ? [company.sector] : []))].sort();
  const query = search.trim().toLowerCase();
  const filtered = companies.filter((company) => {
    if (sector === WATCHLIST && !watchlist.includes(company.slug)) { return false; }
    if (sector !== ALL && sector !== WATCHLIST && company.sector !== sector) { return false; }
    if (type !== "all" && !company.types.includes(type)) { return false; }
    if (venue !== "all" && !company.venues.includes(venue)) { return false; }
    return !query || `${company.name} ${company.sector ?? ""} ${company.rows.map((row) => row.label).join(" ")}`.toLowerCase().includes(query);
  });
  const sorted = [...filtered].sort((a, b) => {
    const left = value(a, sort);
    const right = value(b, sort);
    if (left === null && right === null) { return a.name.localeCompare(b.name); }
    if (left === null) { return 1; }
    if (right === null) { return -1; }
    return direction * (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right)));
  });
  function toggleSort(key: SortKey) {
    if (key === sort) { setDirection((current) => -current); } else { setSort(key); setDirection(key === "name" ? 1 : -1); }
  }

  const byVolume = [...companies].sort((a, b) => b.totals.volume30dUsd - a.totals.volume30dUsd);
  const rank = new Map(byVolume.map((company, index) => [company.slug, index + 1]));
  const maxRound = Math.max(0, ...companies.map((company) => Math.abs(vsRound(company) ?? 0)));
  const maxPremium = Math.max(0, ...companies.map((company) => Math.abs(company.premium ?? 0)));
  const marketCount = companies.reduce((sum, company) => sum + company.rows.length, 0);

  // Rebased lead-market closes for the chosen window.
  const lines = byVolume.map((company, index) => ({
    key: company.slug, name: company.name, colour: LINE_COLOURS[index % LINE_COLOURS.length],
    points: company.series.slice(-(period + 1)),
  }));
  // Volume-weighted change across companies over the window.
  const weighted = byVolume.reduce((acc, company) => {
    const change = seriesChange(company, period);
    if (change === null) { return acc; }
    return { sum: acc.sum + change * company.totals.volume30dUsd, weight: acc.weight + company.totals.volume30dUsd };
  }, { sum: 0, weight: 0 });
  const periodChange = weighted.weight > 0 ? weighted.sum / weighted.weight : null;

  // OpenStocks, PreStocks and xStocks tokens: spot assets priced by their issuer, with no venue volume.
  const issuerCount = companies.reduce((sum, company) => sum + company.issuers.length, 0);
  const typeMix = (["perp", "spot"] as const).map((key) => {
    const rows = companies.flatMap((company) => company.rows.filter((row) => row.marketType === key));
    return { key, count: rows.length, volume: rows.reduce((sum, row) => sum + (row.volume24hUsd ?? 0), 0) };
  }).filter((item) => item.count > 0);

  const pipeline = [...companies].sort((a, b) => (rounds[b.slug]?.date ?? "").localeCompare(rounds[a.slug]?.date ?? ""));

  return <ProShell active={sector === WATCHLIST ? "watchlist" : "screener"} data={data} search={{ value: search, onChange: setSearch }}
    onNav={(key) => pickSector(key === "watchlist" ? WATCHLIST : ALL)}>
    <main className="p-wrap p-main">
      {error && data.data && <div className="p-notice" role="alert">{error} Showing the last successful read.</div>}

      <section className="p-grid-12" aria-label="Market overview">
        <div className="p-panel p-span-8">
          <div className="p-hero-card">
            <div className="p-hero-top">
              <div className="p-hero-figs">
                <span className="p-lbl"><i className="p-dot up" />Pre-IPO markets · 30-day volume</span>
                <div className="p-hero-line">
                  <span className="p-hero-value p-mono">{loading ? "—" : compactUsd(totals.volume30)}</span>
                  <span className={`p-pill ${periodChange === null ? "" : periodChange >= 0 ? "up" : "down"}`}>
                    {periodChange === null ? "—" : `${periodChange >= 0 ? "▲" : "▼"} ${formatSignedPercent(Math.abs(periodChange)).slice(1)}`} · price, {period}D
                  </span>
                </div>
                <span className="p-sub">{`${companies.length} ${companies.length === 1 ? "company" : "companies"}`} · {plural(marketCount, "market")} on {plural(totals.venues.length, "venue")} · {compactUsd(totals.openInterest)} open interest · {compactUsd(totals.offchain)} off-chain value</span>
              </div>
              <div className="p-seg" role="group" aria-label="Chart window">
                {([7, 30, 90] as const).map((days) => <button key={days} type="button" aria-pressed={period === days} onClick={() => setPeriod(days)}>{days}D</button>)}
              </div>
            </div>
            {loading ? <SkeletonChart height={240} label="Loading price chart" /> : <RebasedChart lines={lines} label={`Lead-market price of each company rebased to 100, last ${period} days`} />}
            <div className="p-legend">
              {lines.map((line) => {
                const company = byVolume.find((item) => item.slug === line.key)!;
                return <span key={line.key}><i style={{ background: line.colour }} />{line.name} <PChg value={seriesChange(company, period)} /></span>;
              })}
              <span className="p-faint p-legend-end">Lead-market daily close, rebased to 100</span>
            </div>
          </div>
        </div>

        <div className="p-span-4 p-stack">
          <div className="p-navy-card">
            <span className="p-lbl">24h volume by asset type</span>
            <span className="p-navy-value p-mono">{loading ? "—" : compactUsd(totals.volume24)}</span>
            {totals.volume24 > 0 && <div className="p-mix" role="img" aria-label="24-hour volume split by asset type">
              {typeMix.map((item) => <span key={item.key} style={{ flex: Math.max(item.volume / totals.volume24 * 100, 0.5), background: TYPE_INFO[item.key].colour }} />)}
            </div>}
            {typeMix.map((item) => <div key={item.key} className="p-mix-row">
              <i style={{ background: TYPE_INFO[item.key].colour }} />
              <span className="p-grow">{TYPE_INFO[item.key].name} <em>· {plural(item.count, "market")}{item.key === "spot" && issuerCount ? `, ${plural(issuerCount, "issuer token")}` : ""}</em></span>
              <strong className="p-mono">{compactUsd(item.volume)}</strong>
              <span className="p-mono p-mix-pct">{share(item.volume, totals.volume24)}</span>
            </div>)}
          </div>

          <div className="p-panel p-pad">
            <div className="p-row-between"><span className="p-lbl">Round pipeline</span><span className="p-faint">IPO signal</span></div>
            {pipeline.length ? pipeline.map((company) => {
              const round = rounds[company.slug];
              return <Link key={company.slug} href={`/company/${company.slug}`} className="p-pipe-row">
                <Mark name={company.name} logo={company.logo} size={30} />
                <span className="p-grow"><strong>{company.name}</strong><small>{round ? `${round.name ?? "Round"} · ${monthYear(round.date)} · ${compactUsd(round.valuation)}` : "—"}</small></span>
                {/* No API reports IPO filings or bank mandates yet. */}
                <span className="p-faint p-mono">—</span>
              </Link>;
            }) : loading ? <SkeletonList rows={4} label="Loading round pipeline" mark={30} /> : <PEmpty>No companies.</PEmpty>}
          </div>
        </div>
      </section>

      {byVolume.length > 0 && <section aria-labelledby="pro-movers" className="p-section">
        <PHead title="By 30-day volume" id="pro-movers" aside="Across all markets and venues" />
        <div className="p-movers">
          {byVolume.slice(0, 4).map((company) => {
            const change = seriesChange(company, 1);
            return <Link key={company.slug} href={`/company/${company.slug}`} className="p-mover">
              <div className="p-mover-head">
                <Mark name={company.name} logo={company.logo} size={32} />
                <span className="p-grow"><strong>{company.name}</strong><small>{compactUsd(company.totals.volume30dUsd)} 30d · {plural(company.rows.length, "market")}</small></span>
                <span className={`p-pill ${change === null ? "" : change >= 0 ? "up" : "down"}`}>{change === null ? "—" : `${change >= 0 ? "▲" : "▼"} ${formatSignedPercent(Math.abs(change)).slice(1)}`}</span>
              </div>
              <div className="p-mover-foot">
                <span><span className="p-mover-price p-mono">{formatPrice(sharePrice(company))}</span><small className="p-faint">{company.listed ? `Listed · ${company.listed.exchange} ${company.listed.ticker}` : `implied ${formatPrice(company.impliedSharePrice)}`}</small></span>
                <PSpark points={company.series.slice(-31).map((point) => point.close)} label={`${company.name} lead-market close, 30 days`} />
              </div>
            </Link>;
          })}
        </div>
      </section>}

      <section className="p-panel" aria-labelledby="pro-all">
        <PHead title={sector === WATCHLIST ? "Your watchlist" : "All companies"} id="pro-all">
          <div className="p-seg" role="group" aria-label="Sector">
            {[ALL, ...sectors, WATCHLIST].map((item) => (
              <button key={item} type="button" aria-pressed={sector === item} onClick={() => pickSector(item)}>{item}</button>
            ))}
          </div>
        </PHead>
        <div className="p-filters">
          <span className="p-lbl p-tip">Asset type<AssetTypeTip /></span>
          {([["all", "All types"], ["perp", TYPE_INFO.perp.name], ["spot", TYPE_INFO.spot.name]] as const).map(([key, label]) => (
            <button key={key} type="button" className="p-chip" aria-pressed={type === key} onClick={() => setType(key)}>{label}</button>
          ))}
          <span className="p-grow" />
          <label className="p-select"><span className="p-lbl">Venue</span>
            <select value={venue} onChange={(event) => setVenue(event.target.value)}>
              <option value="all">All venues</option>
              {totals.venues.map((name) => <option key={name} value={name}>{venueName(name)}</option>)}
            </select>
          </label>
        </div>

        {loading ? <DataState loading title="Loading market data" description="Reading every market that trades these companies." />
          : error && !data.data ? <DataState error title="Market data unavailable" description={error} action={refresh} />
          : sorted.length ? <table className="p-table p-fit p-screen">
              <caption className="sr-only">Covered companies with off-chain and market-implied valuations, round valuations, and market activity across venues.</caption>
              <thead><tr>
                <th className="p-sc-star" aria-label="Watchlist" />
                <th className="p-sc-rank">#</th>
                <th aria-sort={sort === "name" ? direction < 0 ? "descending" : "ascending" : "none"}>
                  <button type="button" className="p-sort" data-on={sort === "name"} onClick={() => toggleSort("name")}>Company{sort === "name" ? direction < 0 ? " ↓" : " ↑" : ""}</button>
                </th>
                {COLUMNS.map((column) => (
                  <th key={column.key} className={`r p-sc-${column.key}`} aria-sort={sort === column.key ? direction < 0 ? "descending" : "ascending" : "none"}>
                    <button type="button" className="p-sort" data-on={sort === column.key} onClick={() => toggleSort(column.key)} title={column.title}>
                      {column.label}{sort === column.key ? direction < 0 ? " ↓" : " ↑" : ""}
                    </button>
                  </th>
                ))}
                <th className="r p-sc-trend">30D trend</th>
              </tr></thead>
              <tbody>{sorted.map((company) => {
                const watched = watchlist.includes(company.slug);
                const round = rounds[company.slug];
                const roundGap = vsRound(company);
                const price = sharePrice(company);
                return <tr key={company.slug}>
                  <td className="p-sc-star"><button type="button" className="p-star" aria-pressed={watched} onClick={() => toggleWatch(company.slug)}
                    aria-label={`${watched ? "Remove" : "Add"} ${company.name} ${watched ? "from" : "to"} watchlist`}><Star size={16} fill={watched ? "currentColor" : "none"} strokeWidth={1.75} /></button></td>
                  <td className="p-mono p-faint p-sc-rank">{rank.get(company.slug)}</td>
                  <td>
                    <Link href={`/company/${company.slug}`} className="p-co">
                      <Mark name={company.name} logo={company.logo} size={32} />
                      <span className="p-co-text">
                        <span className="p-co-line"><strong className="p-co-name">{company.name}</strong>{company.listed && <ListedBadge listed={company.listed} />}</span>
                        <small className="p-faint p-co-sector">{company.sector ?? ""}</small>
                        <span className="p-co-meta">{plural(company.rows.length, "market")} · {plural(company.venues.length, "venue")} <span className="p-co-tags">{company.types.map((key) => <TypeTag key={key} type={key} />)}</span></span>
                      </span>
                    </Link>
                  </td>
                  <td className="r p-sc-price"><span className="p-stack-cell"><strong className="p-mono"><Flash value={price}>{formatPrice(price)}</Flash></strong><small className="p-mono">{company.listed ? "implied · listed" : <>implied <Flash value={company.impliedSharePrice}>{formatPrice(company.impliedSharePrice)}</Flash></>}</small></span></td>
                  <td className="r p-sc-c24"><PChg value={seriesChange(company, 1)} /></td>
                  <td className="r p-sc-c7"><PChg value={seriesChange(company, 7)} /></td>
                  <td className="r p-sc-c30"><PChg value={seriesChange(company, 30)} /></td>
                  <td className="r p-sc-valuation"><span className="p-stack-cell"><strong className="p-mono">{compactUsd(company.offchainValuation)}</strong><small className="p-mono">{company.listed ? (valuationBasis(company) ?? "off-chain") : `implied ${compactUsd(company.impliedValuation)}`}</small></span></td>
                  <td className="r p-sc-vsRound">{roundGap === null ? <span className="p-mono p-flat">—</span>
                    : <span className="p-stack-cell"><span className="p-divcell"><PDivBar value={roundGap} max={maxRound} width={44} /><PChg value={roundGap} /></span><small className="p-mono">{round ? `${compactUsd(round.valuation)} · ${monthYear(round.date)}` : "—"}</small></span>}</td>
                  <td className="r p-sc-premium">{company.premium === null && company.listed ? <span className="p-pill">Listed</span> : company.premium === null ? <span className="p-mono p-flat" title="No market with a confirmed price basis">—</span>
                    : <span className="p-divcell"><PDivBar value={company.premium} max={maxPremium} width={44} /><PChg value={company.premium} /></span>}</td>
                  <td className="r p-sc-volume"><span className="p-stack-cell"><strong className="p-mono">{compactUsd(company.totals.volume24hUsd)}</strong><small className="p-mono">30d {compactUsd(company.totals.volume30dUsd)}</small></span></td>
                  <td className="r p-sc-openInterest"><span className="p-stack-cell"><strong className="p-mono">{company.totals.openInterestUsd ? compactUsd(company.totals.openInterestUsd) : "—"}</strong><small className="p-mono">fund {fundingText(company.funding)}</small></span></td>
                  <td className="r p-sc-fees"><span className="p-mono">{fullUsd(company.totals.estFees30dUsd)}</span></td>
                  <td className="r p-sc-trend"><PSpark points={company.series.slice(-31).map((point) => point.close)} width={88} label={`${company.name} lead-market close, 30 days`} /></td>
                </tr>;
              })}</tbody>
            </table>
          : <PEmpty>{sector === WATCHLIST && !watchlist.length ? "Star a company to add it to your watchlist." : "No companies match these filters."}</PEmpty>}

        <div className="p-panel-foot">
          <span>Showing {sorted.length} of {`${companies.length} ${companies.length === 1 ? "company" : "companies"}`} · share price is off-chain (listed: market-implied); implied valuation is the median across markets with a confirmed price basis · changes are the lead market&apos;s daily close</span>
          <span>Funding is open-interest weighted across perps. Round valuations from disclosed funding rounds.</span>
        </div>
      </section>
    </main>
  </ProShell>;
}
