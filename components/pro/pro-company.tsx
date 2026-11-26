"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Globe2, Star } from "lucide-react";
import { formatDate, formatMoney, formatPrice, formatSignedPercent, type CompanyInsights, type MarketData } from "@/app/data";
import { fundingRounds, type CompanyMarketData } from "@/lib/company-data";
import { useRemoteData } from "@/hooks/use-market-data";
import { useWatchlist } from "@/hooks/use-watchlist";
import { DataState } from "@/components/data-state";
import { Mark } from "@/components/pc";
import { compactUsd, fundingText, marketPrice, plural, spotPremium, TYPE_INFO, type AssetType, type IssuerToken, type MarketRow } from "@/lib/coverage-view";
import { AssetTypeTip, fullUsd, ListedBadge, sharePrice, valuationBasis, monthYear, PChg, PDivBar, PEmpty, PFund, PHead, PPremium, PShare, seriesChange, share, TypeTag, useProData, venueName } from "./pro-kit";
import { SplitPriceChart } from "./pro-charts";
import { ExchangeMark, sameMark, VenueCell, VenueLogo } from "@/components/exchange-mark";
import { Pair } from "./pro-kit";
import { ProShell } from "./pro-shell";
import { DerivedPrice } from "@/components/derived-price";
import { RequestAccessLink } from "@/components/request-access-link";
import { TradeButton } from "@/components/trade/trade-button";
import { Flash } from "@/components/flash";
import { SkeletonLines, SkeletonList, SkeletonTable, useCrosshair } from "@/components/skeleton";

/**
 * Pro company page: the "company page" artboard. Aside with the full stat
 * list, KPI tiles and price chart, every market with fee rates and status,
 * venue / funding / asset-type panels, then disclosed rounds and news.
 */

type SortKey = "price" | "impliedValuation" | "volume24hUsd" | "volume30dUsd" | "openInterestUsd" | "fundingRateAnnualized" | "estFees30dUsd" | "feeRateBps";
const HEADERS: { key: SortKey; label: string }[] = [
  { key: "price", label: "Quote" }, { key: "impliedValuation", label: "Implied val." }, { key: "volume24hUsd", label: "24h vol" }, { key: "volume30dUsd", label: "30d vol" },
  { key: "openInterestUsd", label: "Open int." }, { key: "fundingRateAnnualized", label: "Funding APR" },
  { key: "estFees30dUsd", label: "Fees 30d" }, { key: "feeRateBps", label: "Taker" },
];
/** What the perp-only columns hold when just spot rows are showing. */
const SPOT_LABELS: Partial<Record<SortKey, string>> = { openInterestUsd: "Market cap", fundingRateAnnualized: "Holders" };
const VENUE_COLOURS = ["#0f1a2b", "#1f87dd", "#f29d12", "#5a4632", "#9ca3af", "#bcd8fb", "#1fbf6c", "#374151"];
const SHADES = ["#0f1a2b", "#1f87dd", "#bcd8fb", "#f29d12"];
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ProCompany({ slug }: { slug: string }) {
  const data = useProData();
  const { companies, loading, error, refresh } = data;
  const market = useRemoteData<MarketData>("/api/markets");
  const profile = market.data?.companies.find((item) => item.slug === slug) ?? null;
  const insights = useRemoteData<CompanyInsights>(profile ? `/api/companies/${encodeURIComponent(profile.id)}/insights` : null);
  const marketData = useRemoteData<CompanyMarketData>(`/api/companies/${encodeURIComponent(slug)}/market-data`);
  const { watchlist, toggleWatch } = useWatchlist();
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [type, setType] = useState<AssetType | "all">("all");
  const [venue, setVenue] = useState("all");
  const [sort, setSort] = useState<SortKey>("volume30dUsd");
  const [direction, setDirection] = useState(-1);

  const company = companies.find((item) => item.slug === slug);
  // The one crosshair skeleton on this page: the price chart, while the company loads.
  const chartSkeleton = useCrosshair(!company && loading);
  if (!company && loading) {
    return <ProShell active={`company:${slug}`} data={data}><main className="p-wrap p-main">
      <div className="p-crumbs"><Link href="/" className="p-back"><ChevronLeft size={15} />All companies</Link></div>
      <div className="p-detail-top">
        <aside className="p-panel p-aside"><SkeletonList rows={1} mark={48} label="Loading company" /><SkeletonLines lines={2} height={22} /><SkeletonLines lines={10} /></aside>
        <div className="p-detail-main">
          <div className="p-kpis">{[0, 1, 2, 3].map((index) => <div key={index} className="p-panel p-kpi"><SkeletonLines lines={2} height={16} /></div>)}</div>
          <section className="p-panel" aria-label="Price chart loading">
            <PHead title="Lead-market quote" />
            <div className="p-pad"><div ref={chartSkeleton} className="p-figure-ph">
              <div className="p-row-base"><span className="p-mono p-chart-total">$—</span><span className="p-faint">— over 30D</span></div>
              <div className="p-figure-ph-plot" style={{ height: 236 }}><span /><span /><span /><span /></div>
            </div></div>
          </section>
        </div>
      </div>
      <div className="p-panel"><SkeletonTable rows={5} cols={7} label="Loading markets" /></div>
    </main></ProShell>;
  }
  if (!company) {
    return <ProShell active={`company:${slug}`} data={data}><main className="p-wrap p-main">
      <div className="p-crumbs"><Link href="/" className="p-back"><ChevronLeft size={15} />All companies</Link></div>
      <div className="p-panel"><DataState loading={loading} error={!!error}
        title={loading ? "Loading company" : error ? "Market data unavailable" : "Company not found"}
        description={loading ? "Reading every market that trades this company." : error ?? "This company is not covered."}
        action={error ? refresh : undefined} /></div>
    </main></ProShell>;
  }

  const { totals } = company;
  const watched = watchlist.includes(company.slug);
  const byVolume = [...companies].sort((a, b) => b.totals.volume30dUsd - a.totals.volume30dUsd);
  const rank = byVolume.findIndex((item) => item.slug === slug) + 1;
  const lead = company.main.find((row) => row.price !== null) ?? null;
  const funding = insights.data?.funding.length ? insights.data.funding : fundingRounds(marketData.data ?? undefined, slug);
  const lastRound = funding.find((round) => round.valuation !== null && round.valuation > 0) ?? null;
  const vsRound = lastRound && company.offchainValuation ? company.offchainValuation / lastRound.valuation! - 1 : null;
  const venueColour = new Map(company.venues.map((name, index) => [name, VENUE_COLOURS[index % VENUE_COLOURS.length]]));
  const change24 = seriesChange(company, 1);

  const keep = (row: MarketRow) => (type === "all" || row.marketType === type) && (venue === "all" || row.venue === venue);
  const sorter = (a: MarketRow, b: MarketRow) => direction * (((a[sort] ?? -Infinity) as number) - ((b[sort] ?? -Infinity) as number));
  // Perpetuals and spot are listed apart: perps on the main basis, then any on
  // a different unit basis; spot pairs on exchanges, then issuers' own tokens.
  const perpRows = company.main.filter((row) => row.marketType === "perp" && keep(row)).sort(sorter);
  const offRows = company.off.filter((row) => row.marketType === "perp" && keep(row)).sort(sorter);
  const spotRows = [...company.main, ...company.off].filter((row) => row.marketType === "spot" && keep(row)).sort(sorter);
  // Each issuer is a venue of its own, so the venue switch lists it beside the exchanges.
  const issuers = type === "all" || type === "spot" ? company.issuers.filter((token) => venue === "all" || venue === token.issuer).sort((a, b) => (b.tokenMarketCap ?? 0) - (a.tokenMarketCap ?? 0)) : [];
  const perpShown = perpRows.length + offRows.length;
  const spotShown = spotRows.length + issuers.length;
  function toggleSort(key: SortKey) {
    if (key === sort) { setDirection((current) => -current); } else { setSort(key); setDirection(-1); }
  }

  const ranked = [...company.rows].sort((a, b) => (b.volume30dUsd ?? 0) - (a.volume30dUsd ?? 0));
  const segments = totals.volume30dUsd > 0 ? [
    ...ranked.slice(0, 4).filter((row) => (row.volume30dUsd ?? 0) > 0).map((row, index) => ({ label: `${row.provider} ${row.label}`, value: row.volume30dUsd ?? 0, colour: SHADES[index] })),
    ...(ranked.length > 4 ? [{ label: plural(ranked.length - 4, "other"), value: ranked.slice(4).reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0), colour: "#d1d5db" }] : []),
  ].filter((segment) => segment.value > 0) : [];
  const venueBars = company.venues.map((name) => {
    const rows = company.rows.filter((row) => row.venue === name);
    return { name, count: rows.length, volume: rows.reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0), oi: rows.reduce((sum, row) => sum + (row.openInterestUsd ?? 0), 0) };
  }).sort((a, b) => b.volume - a.volume);
  const perps = company.rows.filter((row) => row.marketType === "perp").sort((a, b) => (b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0));
  const maxFunding = Math.max(0.0001, ...perps.map((row) => Math.abs(row.fundingRateAnnualized ?? 0)));
  const series = company.series.slice(-(range + 1));
  const rangeChange = series.length >= 2 ? series[series.length - 1].close / series[0].close - 1 : null;
  const spotCount = company.rows.filter((row) => row.marketType === "spot").length + company.issuers.length;

  const stats: { label: string; value: string; sub: string; tone?: number | null }[] = [
    { label: "30d volume", value: compactUsd(totals.volume30dUsd), sub: `${compactUsd(totals.volume24hUsd)} in 24h` },
    { label: "Open interest", value: totals.openInterestUsd ? compactUsd(totals.openInterestUsd) : "—", sub: plural(company.perps, "perp market") },
    { label: "Funding APR", value: fundingText(company.funding), sub: "open-interest weighted", tone: company.funding },
    { label: "Est. fees (30d)", value: fullUsd(totals.estFees30dUsd), sub: "at base taker rates" },
    { label: "Markets", value: `${company.rows.length} on ${plural(company.venues.length, "venue")}`, sub: company.types.map((key) => TYPE_INFO[key].tag).join(" · ") || "—" },
    { label: valuationBasis(company) ? `Off-chain valuation · ${valuationBasis(company)}` : "Off-chain valuation", value: compactUsd(company.offchainValuation), sub: data.data?.offchainAsOf ? `as of ${formatDate(data.data.offchainAsOf)}` : "—" },
    { label: "Implied valuation", value: compactUsd(company.impliedValuation), sub: company.valuedMarkets ? `median of ${plural(company.valuedMarkets, "market")} with a confirmed basis` : "no market with a confirmed basis" },
    { label: "Implied share price", value: formatPrice(company.impliedSharePrice), sub: "implied valuation ÷ total shares" },
    { label: "Last priced round", value: lastRound ? compactUsd(lastRound.valuation) : "—", sub: lastRound ? `${lastRound.name ?? "Round"} · ${monthYear(lastRound.date)}` : "—" },
    { label: "vs last priced round", value: vsRound === null ? "—" : formatSignedPercent(vsRound), sub: lastRound ? `off-chain valuation vs ${compactUsd(lastRound.valuation)} round` : "off-chain valuation vs last priced round", tone: vsRound },
    { label: "vs off-chain", value: company.premium !== null ? formatSignedPercent(company.premium) : company.listed ? "Listed" : "—", sub: "implied valuation vs off-chain valuation", tone: company.premium },
    { label: "Total shares", value: company.totalShares === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(company.totalShares), sub: "off-chain" },
    { label: "Founded · HQ", value: profile?.founded ?? "—", sub: profile?.headquarters ?? "—" },
    // No source reports S-1 filings or bank mandates yet.
    { label: "IPO signal", value: "—", sub: "not reported" },
  ];
  const kpis: { label: string; value: string; sub: string; tone?: number | null }[] = [
    { label: "30d volume", value: compactUsd(totals.volume30dUsd), sub: `${compactUsd(totals.volume24hUsd)} last 24h` },
    { label: "Open interest", value: totals.openInterestUsd ? compactUsd(totals.openInterestUsd) : "—", sub: `across ${plural(company.perps, "perp")}` },
    { label: "Est. fees 30d", value: totals.estFees30dUsd ? `~${compactUsd(totals.estFees30dUsd)}` : "—", sub: fullUsd(totals.estFees30dUsd) },
    { label: "Funding APR", value: fundingText(company.funding), sub: company.funding === null ? "not reported" : company.funding < 0 ? "shorts paying longs" : "longs paying shorts", tone: company.funding },
  ];
  const toneClass = (tone?: number | null) => tone === undefined || tone === null ? "" : tone > 0 ? "p-up" : tone < 0 ? "p-down" : "";

  const dash = <span className="p-mono p-flat">—</span>;
  /** Venue and provider in one short line, shown in the pair cell once the exchange column drops out. */
  const where = (venueLabel: string, provider: string) => sameMark(provider, venueLabel) ? venueLabel : `${venueLabel} via ${provider}`;
  const pairCell = (label: string, url: string | null | undefined, venueLabel: string, provider: string, sub?: string) => <td>
    <span className="p-mc-text"><span className="p-prov"><span className="p-cm-mark"><VenueLogo name={venueLabel} size={18} /></span>
      <Pair label={label} url={url} where={venueLabel} /></span>
      {sub && <small className="p-faint mk-tg-tokname">{sub}</small>}
      <small className="p-cm-inline">{where(venueLabel, provider)}</small></span>
  </td>;

  const marketRow = (row: MarketRow) => {
    const deviation = company.price && row.price ? row.price / company.price - 1 : null;
    const portion = totals.volume30dUsd > 0 && row.volume30dUsd ? row.volume30dUsd / totals.volume30dUsd : 0;
    const active = (row.volume24hUsd ?? 0) > 0;
    const spot = row.marketType === "spot";
    const premium = spot && !row.offBasis ? spotPremium(row.price, company) : null;
    return <tr key={`${row.venue}-${row.marketType}-${row.market}`} className={row.offBasis ? "mk-tg-off" : undefined}>
      <td className="p-cm-provider"><VenueCell venue={venueName(row.venue)} provider={row.provider} size={26} /></td>
      {pairCell(row.label, row.tradeUrl, venueName(row.venue), row.provider)}
      <td className="r"><span className="p-stack-cell"><strong className="p-mono"><Flash value={row.price}>{marketPrice(row.price)}</Flash></strong>
        {premium !== null ? <small><PPremium value={premium} /> <span className="p-faint">vs off-chain</span></small>
          : row.offBasis ? (company.price && row.price ? <small className="p-mono p-warn">≈{(row.price / company.price).toFixed(1)}× main</small> : null)
          : !spot && deviation !== null ? <small className="p-mono">{Math.abs(deviation) < 0.00005 ? "at median" : `${formatSignedPercent(deviation)} vs med.`}</small> : null}</span></td>
      <td className="r p-cm-impliedValuation">{row.impliedValuation === null ? dash : <span className="p-stack-cell"><strong className="p-mono">{compactUsd(row.impliedValuation)}</strong>
        {row.basis && <small>{row.basis.kind === "share" ? "per share" : `÷ ${compactUsd(row.basis.notionalShares).replace("$", "")} shares`}</small>}</span>}</td>
      <td className="r p-mono p-cm-volume24hUsd">{compactUsd(row.volume24hUsd)}</td>
      <td className="r p-cm-volume30dUsd"><span className="p-divcell"><PShare value={portion} width={48} /><span className="p-stack-cell"><strong className="p-mono">{compactUsd(row.volume30dUsd)}</strong><small className="p-mono">{share(row.volume30dUsd ?? 0, totals.volume30dUsd)}</small></span></span></td>
      {spot ? <>
        <td className="r p-cm-openInterestUsd">{dash}</td>
        <td className="r p-cm-fundingRateAnnualized">{dash}</td>
      </> : <>
        <td className="r p-mono p-cm-openInterestUsd">{compactUsd(row.openInterestUsd)}</td>
        <td className="r p-cm-fundingRateAnnualized">{row.fundingRateAnnualized === null ? dash
          : <span className="p-divcell"><PDivBar value={row.fundingRateAnnualized} max={maxFunding} width={52} /><PFund value={row.fundingRateAnnualized} /></span>}</td>
      </>}
      <td className="r p-mono p-cm-estFees30dUsd">{fullUsd(row.estFees30dUsd)}</td>
      <td className="r p-mono p-cm-feeRateBps">{row.feeRateBps.toFixed(1)} bp</td>
      <td className="r p-cm-status"><span className={`p-status ${active ? "live" : "stale"}`}><i />{active ? "Active" : "No 24h vol"}</span></td>
    </tr>;
  };

  /** An issuer's own token: its published price and implied valuation, the tokens in circulation and who holds them. */
  const issuerRow = (token: IssuerToken) => {
    const premium = spotPremium(token.price, company);
    const gap = token.impliedValuation !== null && company.offchainValuation ? token.impliedValuation / company.offchainValuation - 1 : null;
    return <tr key={`${token.issuer}-${token.symbol}`}>
      <td className="p-cm-provider"><VenueCell venue={token.issuer} provider={token.chain} size={26} /></td>
      {pairCell(token.symbol, token.url, token.chain, token.issuer, token.name)}
      <td className="r"><span className="p-stack-cell"><strong className="p-mono">{formatPrice(token.price)}</strong>
        {premium !== null && <small><PPremium value={premium} /> <span className="p-faint">vs off-chain</span></small>}</span></td>
      <td className="r p-cm-impliedValuation">{token.impliedValuation === null ? dash : <span className="p-stack-cell"><strong className="p-mono">{compactUsd(token.impliedValuation)}</strong>
        {gap !== null && <small className="p-mono">{formatSignedPercent(gap)} vs off-chain</small>}</span>}</td>
      <td className="r p-mono p-cm-volume24hUsd">{token.volume24h === undefined || token.volume24h === null ? dash : compactUsd(token.volume24h)}</td>
      <td className="r p-cm-volume30dUsd">{dash}</td>
      <td className="r p-mono p-cm-openInterestUsd">{token.tokenMarketCap === null ? dash : compactUsd(token.tokenMarketCap)}</td>
      <td className="r p-mono p-cm-fundingRateAnnualized">{token.holders === null ? dash : token.holders.toLocaleString("en-US")}</td>
      <td className="r p-cm-estFees30dUsd">{dash}</td>
      <td className="r p-cm-feeRateBps">{dash}</td>
      <td className="r p-cm-status"><span className="mk-tg-status">
        <span className="p-status live"><i />Issuer</span>
        <TradeButton issuer={token.issuer} symbol={token.symbol} companySlug={company.slug} companyName={company.name} />
      </span></td>
    </tr>;
  };

  return <ProShell active={`company:${slug}`} data={data}>
    <main className="p-wrap p-main">
      <div className="p-crumbs">
        <Link href="/" className="p-back"><ChevronLeft size={15} />All companies</Link>
        <span>Markets</span><span aria-hidden>/</span>{company.sector && <><span>{company.sector}</span><span aria-hidden>/</span></>}<strong>{company.name}</strong>
      </div>
      {error && <div className="p-notice" role="alert">{error} Showing the last successful read.</div>}

      <nav className="p-switcher" aria-label="Switch company">
        {byVolume.map((item) => (
          <Link key={item.slug} href={`/company/${item.slug}`} aria-current={item.slug === slug ? "page" : undefined}>
            <strong>{item.name}</strong><small className="p-mono">{compactUsd(item.totals.volume30dUsd)} · {plural(item.rows.length, "market")}</small>
          </Link>
        ))}
      </nav>

      <div className="p-detail-top">
        <aside className="p-panel p-aside">
          <div className="p-aside-id">
            <Mark name={company.name} logo={company.logo} size={48} />
            <div className="p-grow">
              <h1>{company.name}</h1>
              <div className="p-aside-sub">{company.listed && <ListedBadge listed={company.listed} />}{company.sector && <span>{company.sector}</span>}{rank > 0 && <span className="p-pill">#{rank} by volume</span>}</div>
            </div>
            <button type="button" className="p-star round" onClick={() => toggleWatch(company.slug)} aria-pressed={watched} aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}>
              <Star size={17} fill={watched ? "currentColor" : "none"} strokeWidth={1.75} />
            </button>
          </div>
          <div className="p-aside-price">
            <span className="p-lbl">{company.listed ? "Implied share price · listed" : "Off-chain share price"}</span>
            <div className="p-row-base">
              <span className="p-big p-mono">{formatPrice(sharePrice(company))}</span>
              <span className={`p-pill ${change24 === null ? "" : change24 >= 0 ? "up" : "down"}`}>{change24 === null ? "—" : `${change24 >= 0 ? "▲" : "▼"} ${formatSignedPercent(Math.abs(change24)).slice(1)}`} 24h</span>
            </div>
            <span className="p-sub">{company.listed
              ? `Listed on ${company.listed.exchange} as ${company.listed.ticker} · off-chain share price ${formatPrice(company.offchainPrice)} · implied valuation ${compactUsd(company.impliedValuation)}`
              : `Implied share price ${formatPrice(company.impliedSharePrice)} from ${plural(company.valuedMarkets, "market")} with a confirmed basis · implied valuation ${compactUsd(company.impliedValuation)}`}</span>
          </div>
          <dl className="p-stats">
            {stats.map((stat) => <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd><strong className={`p-mono ${toneClass(stat.tone)}`}>{stat.value}</strong><small>{stat.sub}</small></dd>
            </div>)}
          </dl>
          <div className="p-actions">
            {lead?.tradeUrl && <a className="p-btn p-btn-primary" href={lead.tradeUrl} target="_blank" rel="noopener noreferrer">Trade on {venueName(lead.venue)}</a>}
            <RequestAccessLink companyName={company.name} variant="pro" />
            {profile?.website && <a className="p-btn p-btn-outline" href={profile.website} target="_blank" rel="noopener noreferrer"><Globe2 size={14} />Website</a>}
          </div>
        </aside>

        <div className="p-detail-main">
          <div className="p-kpis">
            {kpis.map((kpi) => <div className="p-panel p-kpi" key={kpi.label}>
              <span className="p-lbl">{kpi.label}</span>
              <strong className={`p-mono ${toneClass(kpi.tone)}`}>{kpi.value}</strong>
              <small>{kpi.sub}</small>
            </div>)}
          </div>
          <section className="p-panel" aria-labelledby="p-price-h">
            <PHead title="Lead-market quote" id="p-price-h" aside={company.seriesMarket ? `Daily close · ${company.seriesMarket.label} on ${venueName(company.seriesMarket.venue)}, the most-traded market` : "Daily close of the most-traded market"}>
              <div className="p-seg" role="group" aria-label="Chart range">
                {([7, 30, 90] as const).map((days) => <button key={days} type="button" aria-pressed={range === days} onClick={() => setRange(days)}>{days}D</button>)}
              </div>
            </PHead>
            <div className="p-pad">
              <div className="p-row-base" style={{ marginBottom: 8 }}>
                <span className="p-mono p-chart-total">{series.length ? money(series[series.length - 1].close) : "—"}</span>
                <PChg value={rangeChange} arrow /><span className="p-faint">over {range}D</span>
              </div>
              <SplitPriceChart points={series} label={`${company.name} daily close, last ${range} days`} money={money} />
            </div>
            <div className="p-panel-foot">
              <span>{plural(series.length, "daily close")}{company.offchainPrice ? ` · off-chain ${formatPrice(company.offchainPrice)}` : ""}</span>
              <span>{series.length ? `${formatDate(series[0].at)} – ${formatDate(series[series.length - 1].at)}` : "—"} · daily volume per market: —</span>
            </div>
          </section>
          <div className="p-trio p-trio-tight">
            <div className="p-panel">
              <PHead title="Volume by venue" />
              <div className="p-pad p-bars">
                {venueBars.length ? venueBars.map((bar) => <div key={bar.name} className="p-bar-row">
                  <div className="p-row-between"><span className="p-prov"><VenueLogo name={venueName(bar.name)} size={18} /><strong>{venueName(bar.name)}</strong> <span className="p-faint">· {plural(bar.count, "market")} · OI {compactUsd(bar.oi)}</span></span>
                    <span className="p-mono"><strong>{compactUsd(bar.volume)}</strong> <span className="p-faint">{share(bar.volume, totals.volume30dUsd)}</span></span></div>
                  <PShare value={venueBars[0].volume > 0 ? bar.volume / venueBars[0].volume : 0} width="100%" colour={venueColour.get(bar.name)} />
                </div>) : <PEmpty>No venues list this company.</PEmpty>}
              </div>
            </div>
            <div className="p-panel">
              <PHead title="Funding across perps" aside="APR · shorts paid ← → longs paid" />
              <div className="p-pad p-bars">
                {perps.length ? perps.map((row) => <div key={`${row.venue}-${row.market}`} className="p-fund-row">
                  <span title={row.label} className="p-prov"><ExchangeMark provider={row.provider} venue={venueName(row.venue)} size={18} /><strong>{row.provider}</strong> <span className="p-faint p-mono">{row.label}</span></span>
                  <span className="p-fund-track">{row.fundingRateAnnualized !== null && <span className={row.fundingRateAnnualized >= 0 ? "up" : "down"}
                    style={{ left: `${row.fundingRateAnnualized >= 0 ? 50 : 50 - Math.min(Math.abs(row.fundingRateAnnualized) / maxFunding, 1) * 50}%`, width: `${Math.min(Math.abs(row.fundingRateAnnualized) / maxFunding, 1) * 50}%` }} />}</span>
                  <PFund value={row.fundingRateAnnualized} />
                </div>) : <PEmpty>No perpetual markets list this company.</PEmpty>}
              </div>
            </div>
            <div className="p-panel">
              <PHead title={<span className="p-tip">Asset types<AssetTypeTip /></span>} />
              <div className="p-pad">
                {(["perp", "spot"] as const).map((key) => {
                  const count = key === "spot" ? spotCount : company.perps;
                  return <div className="p-type-row" key={key} style={{ opacity: count ? 1 : 0.55 }}>
                    <TypeTag type={key} />
                    <span><strong>{TYPE_INFO[key].name}</strong> <span className="p-faint">· {count ? plural(count, "market") : "none listed"}</span><small>{TYPE_INFO[key].description}</small></span>
                  </div>;
                })}
                {/* SPV units and tokenized notes appear in the design; no feed lists them yet. */}
                {["SPV units", "Tokenized notes"].map((name) => <div className="p-type-row" key={name} style={{ opacity: 0.55 }}>
                  <span className="p-tag">{name === "SPV units" ? "SPV" : "NOTE"}</span>
                  <span><strong>{name}</strong> <span className="p-faint">· —</span><small>Not covered by the markets feed yet.</small></span>
                </div>)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="p-panel" aria-labelledby="p-trades-h">
        <PHead title={`Where ${company.name} trades`} id="p-trades-h">
          <div className="p-row-wrap">
            <div className="p-seg" role="group" aria-label="Asset type">
              <button type="button" aria-pressed={type === "all"} onClick={() => setType("all")}>All {company.rows.length + company.issuers.length}</button>
              {company.perps > 0 && <button type="button" aria-pressed={type === "perp"} onClick={() => setType("perp")}>Perp {company.perps}</button>}
              {spotCount > 0 && <button type="button" aria-pressed={type === "spot"} onClick={() => setType("spot")}>Spot {spotCount}</button>}
            </div>
            {company.venues.length + new Set(company.issuers.map((token) => token.issuer)).size > 1 && <div className="p-seg" role="group" aria-label="Venue">
              <button type="button" aria-pressed={venue === "all"} onClick={() => setVenue("all")}>All venues</button>
              {company.venues.map((name) => <button key={name} type="button" aria-pressed={venue === name} onClick={() => setVenue(name)}>{venueName(name)}</button>)}
              {[...new Set(company.issuers.map((token) => token.issuer))].map((name) => <button key={name} type="button" aria-pressed={venue === name} onClick={() => setVenue(name)}>{name}</button>)}
            </div>}
          </div>
        </PHead>
        <div className="p-pad p-summary">
          <span><strong className="p-mono">{compactUsd(totals.volume30dUsd)}</strong> over 30 days · {totals.openInterestUsd ? compactUsd(totals.openInterestUsd) : "no"} open interest · ~{compactUsd(totals.estFees30dUsd)} fees · {plural(company.rows.length, "market")} on {plural(company.venues.length, "venue")}</span>
          {segments.length > 0 && <>
            <div className="p-sharebar" role="img" aria-label="30-day volume share by market">
              {segments.map((segment) => <span key={segment.label} style={{ flex: Math.max(segment.value / totals.volume30dUsd * 100, 0.8), background: segment.colour }} />)}
            </div>
            <div className="p-legend">
              {segments.map((segment) => <span key={segment.label}><i style={{ background: segment.colour }} />{segment.label} <strong className="p-mono">{share(segment.value, totals.volume30dUsd)}</strong></span>)}
              <span className="p-faint p-legend-end">Share of 30d volume</span>
            </div>
          </>}
        </div>
        <div className="p-fitwrap">
          <table className="p-table p-fit p-cmt mk-tg">
            <caption className="sr-only">Every market trading {company.name}: perpetuals first, then spot pairs and issuer tokens.</caption>
            <thead><tr>
              <th className="p-cm-provider">Exchange</th><th>Pair</th>
              {HEADERS.map((header) => {
                // With only spot rows showing, these two columns hold the token market cap and holders.
                const spotOnly = perpShown === 0 && spotShown > 0 ? SPOT_LABELS[header.key] : undefined;
                if (spotOnly) { return <th key={header.key} className={`r p-cm-${header.key}`}>{spotOnly}</th>; }
                return <th key={header.key} className={`r p-cm-${header.key}`} aria-sort={sort === header.key ? direction < 0 ? "descending" : "ascending" : "none"}>
                  <button type="button" className="p-sort" data-on={sort === header.key} onClick={() => toggleSort(header.key)}>{header.label}{sort === header.key ? direction < 0 ? " ↓" : " ↑" : ""}</button>
                </th>;
              })}
              <th className="r p-cm-status">Status</th>
            </tr></thead>
            {perpShown > 0 && <tbody className="mk-tg-body">
              <tr className="mk-tg-group"><th colSpan={11} scope="colgroup"><span className="mk-tg-in">
                <strong>Perpetuals</strong><span className="mk-tg-count">{perpShown}</span>
                <span className="mk-tg-note">Leveraged contracts settled in cash with funding. Quote is compared with the median perp.</span>
              </span></th></tr>
              {perpRows.map(marketRow)}
              {offRows.length > 0 && <>
                <tr className="mk-tg-sub warn"><td colSpan={11}><span className="mk-tg-in">
                  <strong>Different unit basis</strong><span className="mk-tg-count">{offRows.length}</span>
                  <span className="mk-tg-note">Quotes about {company.offRatio ? `${company.offRatio.toFixed(1)}×` : "a multiple of"} the main price, so left out of the median.</span>
                </span></td></tr>
                {offRows.map(marketRow)}
              </>}
            </tbody>}
            {spotShown > 0 && <tbody className="mk-tg-body">
              <tr className="mk-tg-group"><th colSpan={11} scope="colgroup"><span className="mk-tg-in">
                <strong>Spot</strong><span className="mk-tg-count">{spotShown}</span>
                <span className="mk-tg-note">Tokens you hold outright. Quote is compared with the off-chain share price.</span>
              </span></th></tr>
              {perpShown > 0 && <tr className="mk-tg-cols" aria-hidden>
                <td className="p-cm-provider" /><td /><td className="r">Quote</td><td className="r p-cm-impliedValuation">Implied val.</td><td className="r p-cm-volume24hUsd">24h vol</td><td className="r p-cm-volume30dUsd">30d vol</td>
                <td className="r p-cm-openInterestUsd">Market cap</td><td className="r p-cm-fundingRateAnnualized">Holders</td><td className="r p-cm-estFees30dUsd">Fees 30d</td><td className="r p-cm-feeRateBps">Taker</td><td className="r p-cm-status">Status</td>
              </tr>}
              {spotRows.map(marketRow)}
              {issuers.length > 0 && <>
                {spotRows.length > 0 && <tr className="mk-tg-sub"><td colSpan={11}><span className="mk-tg-in">
                  <strong>Issuer tokens</strong><span className="mk-tg-count">{issuers.length}</span>
                  <span className="mk-tg-note">Priced by each issuer and backed by its own holding, so left out of the median.</span>
                </span></td></tr>}
                {issuers.map(issuerRow)}
              </>}
            </tbody>}
            {!perpShown && !spotShown && <tbody><tr><td colSpan={11}><PEmpty>No markets match these filters.</PEmpty></td></tr></tbody>}
          </table>
        </div>
        <div className="p-panel-foot">
          <span>Funding APR is annualized; — means the venue doesn&apos;t report it. Fees are 30-day volume at the taker rate shown, an upper bound.</span>
          <span>Source: venue market data</span>
        </div>
      </section>

      <div className="p-panel mk-derived"><DerivedPrice slug={company.slug} companyName={company.name} /></div>

      <section className="p-duo">
        <div className="p-panel">
          <PHead title="Disclosed funding rounds" />
          {funding.length ? <div className="p-fitwrap"><table className="p-table p-fit p-rounds">
            <thead><tr><th>Round</th><th>Announced</th><th className="r p-rd-raised">Raised</th><th className="r">Post-money</th><th className="p-rd-inv">Lead investor</th></tr></thead>
            <tbody>{funding.map((round) => <tr key={round.id}>
              <td><strong>{round.name ?? "Unnamed round"}</strong></td>
              <td className="p-mono">{formatDate(round.date)}</td>
              <td className="r p-mono p-rd-raised">{formatMoney(round.amount)}</td>
              <td className="r p-mono">{formatMoney(round.valuation)}</td>
              <td className="p-rd-inv">{round.investor ?? "—"}</td>
            </tr>)}</tbody>
          </table></div> : (insights.loading || marketData.loading ? <SkeletonTable rows={5} cols={4} rowHeight={44} label="Loading funding rounds" /> : <PEmpty>No disclosed rounds.</PEmpty>)}
        </div>
        <div className="p-panel">
          <PHead title="News & research" />
          <div className="p-pad p-news">
            {profile?.description && <p className="p-about">{profile.description}</p>}
            {[...(insights.data?.news ?? []), ...(insights.data?.research ?? [])].slice(0, 10).map((article) => (
              <article key={article.id}>
                <span className="p-faint p-mono">{article.source ?? "—"} · {formatDate(article.date)}</span>
                {article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a> : <strong>{article.title}</strong>}
              </article>
            ))}
            {!insights.data?.news.length && !insights.data?.research.length && (insights.loading || market.loading ? <SkeletonLines lines={6} label="Loading news" /> : <PEmpty>No news or research published.</PEmpty>)}
          </div>
        </div>
      </section>
    </main>
  </ProShell>;
}
