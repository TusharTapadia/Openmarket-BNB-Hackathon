"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Globe2, Layers3, RefreshCw, Star } from "lucide-react";
import { formatDate, formatMoney, formatPrice, formatSignedPercent, changeOver, type Article, type CompanyInsights, type FundingRound, type MarketData } from "@/app/data";
import { fundingRounds, type CompanyMarketData } from "@/lib/company-data";
import { useRemoteData } from "@/hooks/use-market-data";
import { useWatchlist } from "@/hooks/use-watchlist";
import {
  compactUsd, companyView, fundingText, marketPrice, plural, TYPE_INFO, VENUE_NAMES,
  type AssetType, type CompanyView, type CoveragePayload, type IssuerToken, type MarketRow,
  spotPremium,
} from "@/lib/coverage-view";
import { MarketHeader } from "./market-header";
import { DataState } from "./data-state";
import { Flash } from "./flash";
import { SkeletonLines, SkeletonList, useCrosshair } from "./skeleton";
import { PriceChart } from "./charts";
import { InfoTip } from "./info-tip";
import { ChangeBadge, DivBar, Mark, SpotGap } from "./pc";
import { ExchangeMark, VenueCell, VenueLogo } from "./exchange-mark";
import { DerivedPrice } from "./derived-price";
import { RequestAccessLink } from "@/components/request-access-link";
import { TradeButton } from "@/components/trade/trade-button";

const DAY = 1;
const VENUE_COLOURS = ["#0f1a2b", "#1f87dd", "#f29d12", "#5a4632", "#9ca3af", "#bcd8fb", "#1fbf6c", "#374151"];
const SHARE_SHADES = ["#0f1a2b", "#1f87dd", "#bcd8fb", "#f29d12"];

const records = ["Funding", "News", "Research", "About"] as const;
type Record_ = typeof records[number];

type SortKey = "price" | "volume24hUsd" | "volume30dUsd" | "openInterestUsd" | "fundingRateAnnualized" | "estFees30dUsd";
const HEADERS: { key: SortKey; label: string; hint?: string }[] = [
  { key: "price", label: "Price", hint: "The market's own quote, and how far it sits from the median of markets on the main price basis." },
  { key: "volume24hUsd", label: "24h vol" },
  { key: "volume30dUsd", label: "30d vol", hint: "Traded over 30 days, with the market's share of the company's 30-day volume." },
  { key: "openInterestUsd", label: "Open int." },
  { key: "fundingRateAnnualized", label: "Funding APR", hint: "Annualized funding. Positive means longs pay shorts; — means the venue does not report it." },
  { key: "estFees30dUsd", label: "Fees 30d", hint: "30-day volume at the venue's base taker fee: an upper bound on fees paid." },
];
/** What the perp-only columns hold when just spot rows are showing. */
const SPOT_LABELS: Partial<Record<SortKey, string>> = { openInterestUsd: "Market cap", fundingRateAnnualized: "Holders" };

function ArticleList({ articles, kind }: { articles: Article[]; kind: string }) {
  if (!articles.length) return <DataState title={`No ${kind.toLowerCase()} available`} description={`No ${kind.toLowerCase()} records have been published for this company.`} />;
  return <div className="article-list">{articles.map((article) => (
    <article className="news-article" key={article.id}>
      <div className="article-meta"><span>{article.source ?? "Source unavailable"}</span><time>{formatDate(article.date)}</time></div>
      <h3>{article.url ? <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}<ExternalLink size={15} /></a> : article.title}</h3>
    </article>
  ))}</div>;
}

function FundingTable({ rounds }: { rounds: FundingRound[] }) {
  return <div className="venues-scroll"><table className="venues-table funding-table">
    <caption className="sr-only">Disclosed funding rounds including their reported status.</caption>
    <thead><tr><th>Funding round</th><th>Announced</th><th className="align-right">Amount raised</th><th className="align-right">Post-money valuation</th><th>Lead investor</th><th>Status</th></tr></thead>
    <tbody>{rounds.map((round) => <tr key={round.id}>
      <td><span className="round-name"><span className="round-icon"><Layers3 size={14} /></span><strong>{round.name ?? "Unnamed round"}</strong></span></td>
      <td>{formatDate(round.date)}</td><td className="tabular align-right">{formatMoney(round.amount)}</td>
      <td className="tabular align-right">{formatMoney(round.valuation)}</td><td>{round.investor ?? "—"}</td>
      <td><span className={`round-status ${round.status === "COMPLETED" ? "completed" : ""}`}>{round.status?.replace(/_/g, " ").toLowerCase() ?? "Unavailable"}</span></td>
    </tr>)}</tbody>
  </table></div>;
}

function Pill<T extends string>({ value, current, onPick, children }: { value: T; current: T; onPick: (value: T) => void; children: React.ReactNode }) {
  return <button type="button" className="pc-seg" aria-pressed={value === current} onClick={() => onPick(value)}>{children}</button>;
}

export function CompanyDetail({ slug }: { slug: string }) {
  const coverage = useRemoteData<CoveragePayload>("/api/coverage", true);
  // The company profile carries the funding rounds, news and research; the
  // prices and markets above it all come from the coverage payload.
  const market = useRemoteData<MarketData>("/api/markets");
  const profile = market.data?.companies.find((item) => item.slug === slug) ?? null;
  const insights = useRemoteData<CompanyInsights>(profile ? `/api/companies/${encodeURIComponent(profile.id)}/insights` : null);
  const marketData = useRemoteData<CompanyMarketData>(`/api/companies/${encodeURIComponent(slug)}/market-data`);
  const { watchlist, toggleWatch } = useWatchlist();
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [type, setType] = useState<AssetType | "all">("all");
  const [venue, setVenue] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("volume30dUsd");
  const [direction, setDirection] = useState(-1);
  const [tab, setTab] = useState<Record_>("Funding");
  // The one crosshair skeleton on this page: the price chart, while the company loads.
  const chartSkeleton = useCrosshair(coverage.loading && !coverage.data);
  const recordsRef = useRef<HTMLElement>(null);

  const companies = useMemo(() => (coverage.data?.companies ?? []).map(companyView), [coverage.data]);
  const company: CompanyView | undefined = companies.find((item) => item.slug === slug);
  const fallbackFunding = useMemo(() => fundingRounds(marketData.data ?? undefined, slug), [marketData.data, slug]);
  const funding = insights.data?.funding.length ? insights.data.funding : fallbackFunding;

  function refresh() { coverage.refresh(); market.refresh(); insights.refresh(); marketData.refresh(); }

  if (!company && coverage.loading) return <div className="app-shell"><MarketHeader /><main className="pc-page detail">
    <div className="pc-crumbs"><Link href="/" className="pc-back"><ChevronLeft size={16} />All companies</Link></div>
    <div className="pc-detail-top">
      <aside className="pc-card pc-aside"><SkeletonList rows={1} mark={48} label="Loading company" /><SkeletonLines lines={2} height={24} /><SkeletonLines lines={10} /></aside>
      <div className="pc-detail-main">
        <div className="pc-kpis">{[0, 1, 2, 3].map((index) => <div key={index} className="pc-card pc-kpi"><SkeletonLines lines={2} height={18} /></div>)}</div>
        <section className="pc-card pc-chart-card" aria-label="Price history loading">
          <div className="pc-chart-head"><div><h2 className="pc-h3">Price</h2><span className="caption">Daily close of the most-traded market</span></div></div>
          <div ref={chartSkeleton} className="pc-chart-ph"><span /><span /><span /><span /></div>
        </section>
      </div>
    </div>
  </main></div>;

  if (!company) return <div className="app-shell"><MarketHeader /><main className="pc-page detail">
    <div className="pc-crumbs"><Link href="/" className="pc-back"><ChevronLeft size={16} />All companies</Link></div>
    <div className="pc-card"><DataState loading={coverage.loading} error={!!coverage.error}
      title={coverage.loading ? "Loading company" : coverage.error ? "Market data unavailable" : "Company not found"}
      description={coverage.loading ? "Reading every market that trades this company." : coverage.error ?? "This company is not covered."}
      action={coverage.error ? coverage.refresh : undefined} /></div>
  </main></div>;

  const watched = watchlist.includes(company.slug);
  const byValuation = [...companies].sort((a, b) => (b.offchainValuation ?? 0) - (a.offchainValuation ?? 0));
  const rank = byValuation.findIndex((item) => item.slug === slug) + 1;
  const { totals } = company;
  const lead = company.main.find((row) => row.price !== null) ?? null;
  const website = profile?.website ?? null;

  // Venue colours are fixed per company so the table dots and the venue bars agree.
  const venueColour = new Map(company.venues.map((name, index) => [name, VENUE_COLOURS[index % VENUE_COLOURS.length]]));

  // Filters and sort over the covered markets; issuer tokens join as spot rows.
  const keep = (row: MarketRow) => (type === "all" || row.marketType === type) && (venue === "all" || row.venue === venue);
  const sorter = (a: MarketRow, b: MarketRow) => {
    const left = a[sort] ?? -Infinity;
    const right = b[sort] ?? -Infinity;
    return direction * ((left as number) - (right as number));
  };
  // Perpetuals and spot are listed apart: perps on the main basis, then any on
  // a different unit basis; spot pairs on exchanges, then issuers' own tokens.
  const perpRows = company.main.filter((row) => row.marketType === "perp" && keep(row)).sort(sorter);
  const offRows = company.off.filter((row) => row.marketType === "perp" && keep(row)).sort(sorter);
  const spotRows = [...company.main, ...company.off].filter((row) => row.marketType === "spot" && keep(row)).sort(sorter);
  // Each issuer is a venue of its own, so the venue pills list it beside the exchanges.
  const issuerRows = type === "all" || type === "spot" ? company.issuers.filter((token) => venue === "all" || venue === token.issuer).sort((a, b) => (b.tokenMarketCap ?? 0) - (a.tokenMarketCap ?? 0)) : [];
  const perpShown = perpRows.length + offRows.length;
  const spotShown = spotRows.length + issuerRows.length;
  const spotCount = company.rows.filter((row) => row.marketType === "spot").length + company.issuers.length;

  function toggleSort(key: SortKey) {
    if (key === sort) { setDirection((value) => -value); }
    else { setSort(key); setDirection(-1); }
  }

  // Concentration: the four biggest markets by 30-day volume, the rest grouped.
  const byVolume = [...company.rows].sort((a, b) => (b.volume30dUsd ?? 0) - (a.volume30dUsd ?? 0));
  const shareSegments = totals.volume30dUsd > 0 ? [
    ...byVolume.slice(0, 4).filter((row) => (row.volume30dUsd ?? 0) > 0).map((row, index) => ({ label: `${row.provider} ${row.label}`, share: (row.volume30dUsd ?? 0) / totals.volume30dUsd, colour: SHARE_SHADES[index] })),
    ...(byVolume.length > 4 ? [{ label: plural(byVolume.length - 4, "other"), share: byVolume.slice(4).reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0) / totals.volume30dUsd, colour: "#d1d5db" }] : []),
  ].filter((segment) => segment.share > 0) : [];

  const venueBars = company.venues.map((name) => {
    const rows = company.rows.filter((row) => row.venue === name);
    return { name, count: rows.length, volume: rows.reduce((sum, row) => sum + (row.volume30dUsd ?? 0), 0) };
  }).sort((a, b) => b.volume - a.volume);
  const perps = company.rows.filter((row) => row.marketType === "perp").sort((a, b) => (b.fundingRateAnnualized ?? -99) - (a.fundingRateAnnualized ?? -99));
  const maxFunding = Math.max(0.0001, ...perps.map((row) => Math.abs(row.fundingRateAnnualized ?? 0)));

  const series = company.series.slice(-(range + 1));
  const seriesChange = series.length >= 2 ? series[series.length - 1].close / series[0].close - 1 : null;

  const stats: { label: string; value: string; sub?: string; tone?: "up" | "down"; hint?: string }[] = [
    { label: company.listed && company.offchainValuationBasis !== "price × shares" ? "Last pre-IPO valuation" : "Off-chain valuation", value: compactUsd(company.offchainValuation), sub: company.offchainValuationBasis === "price × shares" ? `price × shares${coverage.data?.offchainAsOf ? ` · as of ${formatDate(coverage.data.offchainAsOf)}` : ""}` : company.listed ? `listed ${formatDate(company.listed.since)}` : coverage.data?.offchainAsOf ? `as of ${formatDate(coverage.data.offchainAsOf)}` : undefined },
    { label: "Implied valuation", value: compactUsd(company.impliedValuation), sub: company.valuedMarkets ? `median of ${plural(company.valuedMarkets, "market")}` : "contract basis unconfirmed", hint: "The company valuation the markets imply. Perps on a valuation basis count price × notional shares (e.g. 1 billion); per-share contracts count price × total shares. Markets whose basis isn't confirmed are left out." },
    { label: "Market price", value: marketPrice(company.price), sub: company.low !== null && company.high !== null && company.main.length > 1 ? `range ${marketPrice(company.low)}–${marketPrice(company.high)}` : "median of markets" },
    { label: "vs off-chain", value: company.premium === null ? "—" : formatSignedPercent(company.premium), sub: company.listed ? `listed · ${company.listed.exchange} ${company.listed.ticker}` : "implied ÷ off-chain valuation − 1", tone: company.premium === null ? undefined : company.premium >= 0 ? "up" : "down" },
    { label: "30d volume", value: compactUsd(totals.volume30dUsd), sub: `${compactUsd(totals.volume24hUsd)} in 24h` },
    { label: "Open interest", value: totals.openInterestUsd ? compactUsd(totals.openInterestUsd) : "—", sub: plural(company.perps, "perp market") },
    { label: "Funding APR", value: fundingText(company.funding), sub: "open-interest weighted", tone: company.funding === null ? undefined : company.funding >= 0 ? "up" : "down" },
    { label: "Est. fees (30d)", value: totals.estFees30dUsd ? `$${Math.round(totals.estFees30dUsd).toLocaleString("en-US")}` : "—", sub: "across all venues" },
    { label: "Markets", value: `${company.rows.length} on ${plural(company.venues.length, "venue")}`, sub: company.types.map((key) => TYPE_INFO[key].tag).join(" · ") },
    { label: "Total shares", value: company.totalShares === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(company.totalShares), sub: "off-chain" },
  ];

  const kpis = [
    { label: "30d volume", value: compactUsd(totals.volume30dUsd), sub: `${compactUsd(totals.volume24hUsd)} last 24h` },
    { label: "Open interest", value: totals.openInterestUsd ? compactUsd(totals.openInterestUsd) : "—", sub: `across ${plural(company.perps, "perp")}` },
    { label: "Est. fees 30d", value: totals.estFees30dUsd ? `~${compactUsd(totals.estFees30dUsd)}` : "—", sub: totals.estFees30dUsd ? `$${Math.round(totals.estFees30dUsd).toLocaleString("en-US")}` : "no 30-day volume" },
    { label: "Funding APR", value: fundingText(company.funding), sub: company.funding === null ? "not reported" : company.funding < 0 ? "shorts paying longs" : "longs paying shorts", tone: company.funding === null ? undefined : company.funding >= 0 ? "up" : "down" },
  ];

  const dash = <span className="pc-cell-main mk-tg-none">—</span>;
  const usdCell = (value: number | null | undefined) => value === null || value === undefined ? dash : <span className="pc-cell-main mk-tg-num">{compactUsd(value)}</span>;
  const feesCell = (value: number | null) => value === null ? dash : <span className="pc-cell-main mk-tg-num">${Math.round(value).toLocaleString("en-US")}</span>;
  const status = (row: MarketRow) => (row.volume24hUsd ?? 0) > 0 ? <span className="pc-status live"><i />Active</span> : <span className="pc-status stale"><i />No 24h volume</span>;

  /** Price, then one short line: distance from the perp median, or the spot premium to the off-chain price. */
  const priceCell = (row: MarketRow) => {
    const deviation = company.price && row.price ? row.price / company.price - 1 : null;
    const premium = row.marketType === "spot" && !row.offBasis ? spotPremium(row.price, company) : null;
    const note = row.offBasis ? (company.price && row.price ? `≈ ${(row.price / company.price).toFixed(1)}× main price` : null)
      : row.marketType === "spot" || deviation === null ? null
      : Math.abs(deviation) < 0.00005 ? "at median" : `${formatSignedPercent(deviation)} vs median`;
    const flagged = row.offBasis || (row.marketType === "perp" && deviation !== null && Math.abs(deviation) > 0.003);
    return <td className="r"><span className="pc-cell-stack"><Flash value={row.price} className="pc-cell-main">{marketPrice(row.price)}</Flash>
      {premium !== null ? <span className="pc-cell-sub"><SpotGap value={premium} /></span>
        : note && <span className={`pc-cell-sub ${flagged ? "mk-tg-warn" : ""}`}>{note}</span>}</span></td>;
  };

  const volumeCells = (row: MarketRow) => {
    const share = totals.volume30dUsd > 0 && row.volume30dUsd ? row.volume30dUsd / totals.volume30dUsd : 0;
    return <>
      <td className="r">{usdCell(row.volume24hUsd)}</td>
      <td className="r"><span className="pc-divbar-cell"><span className="pc-sharebar"><span style={{ width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%` }} /></span>
        <span className="pc-cell-stack"><span className="pc-cell-main" style={{ fontWeight: 700 }}>{compactUsd(row.volume30dUsd)}</span><span className="pc-cell-sub">{share === 0 ? "—" : share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`}</span></span></span></td>
    </>;
  };

  /** Exchange (venue logo and name, provider underneath) and the pair, linked to trade it. */
  const exchangeCells = (row: MarketRow) => <>
    <td><VenueCell venue={VENUE_NAMES[row.venue] ?? row.venue} provider={row.provider} /></td>
    <td>{row.tradeUrl
      ? <a className="pc-pair" href={row.tradeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.label} on ${VENUE_NAMES[row.venue] ?? row.venue}`}>{row.label}<ExternalLink size={13} /></a>
      : <span className="pc-pair">{row.label}</span>}</td>
  </>;

  /** A perpetual: price, volume, open interest, funding and fees. */
  const perpRow = (row: MarketRow) => <tr key={`${row.venue}-${row.marketType}-${row.market}`} className={row.offBasis ? "mk-tg-off" : undefined}>
    {exchangeCells(row)}
    {priceCell(row)}
    {volumeCells(row)}
    <td className="r">{usdCell(row.openInterestUsd)}</td>
    <td className="r">{row.fundingRateAnnualized === null ? <span className="pc-pct pc-flat">—</span>
      : <span className="pc-divbar-cell"><DivBar value={row.fundingRateAnnualized} max={maxFunding} width={60} /><span className={`pc-divbar-val ${row.fundingRateAnnualized > 0 ? "pc-up" : row.fundingRateAnnualized < 0 ? "pc-down" : "pc-flat"}`}>{fundingText(row.fundingRateAnnualized)}</span></span>}</td>
    <td className="r">{feesCell(row.estFees30dUsd)}</td>
    <td className="r">{status(row)}</td>
  </tr>;

  /** A spot pair on an exchange. Exchanges don't report a token market cap or holders for it. */
  const spotRow = (row: MarketRow) => <tr key={`${row.venue}-${row.marketType}-${row.market}`} className={row.offBasis ? "mk-tg-off" : undefined}>
    {exchangeCells(row)}
    {priceCell(row)}
    {volumeCells(row)}
    <td className="r">{dash}</td>
    <td className="r">{dash}</td>
    <td className="r">{feesCell(row.estFees30dUsd)}</td>
    <td className="r">{status(row)}</td>
  </tr>;

  /** An issuer's own token: its published price, the tokens in circulation and who holds them. */
  const issuerRow = (token: IssuerToken) => {
    const premium = spotPremium(token.price, company);
    return <tr key={`${token.issuer}-${token.symbol}`}>
      <td><VenueCell venue={token.issuer} provider={token.chain} /></td>
      <td><span className="pc-cell-stack mk-tg-pair">{token.url
        ? <a className="pc-pair" href={token.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${token.symbol} on ${token.issuer}`}>{token.symbol}<ExternalLink size={13} /></a>
        : <span className="pc-pair">{token.symbol}</span>}<span className="pc-cell-sub">{token.name}</span></span></td>
      <td className="r"><span className="pc-cell-stack"><span className="pc-cell-main">{formatPrice(token.price)}</span>
        {premium !== null && <span className="pc-cell-sub"><SpotGap value={premium} /></span>}</span></td>
      <td className="r">{usdCell(token.volume24h)}</td>
      <td className="r">{dash}</td>
      <td className="r">{usdCell(token.tokenMarketCap)}</td>
      <td className="r">{token.holders === null ? dash : <span className="pc-cell-main mk-tg-num">{token.holders.toLocaleString("en-US")}</span>}</td>
      <td className="r">{dash}</td>
      <td className="r"><span className="mk-tg-status">
        <span className="pc-status live"><i />Issuer</span>
        <TradeButton issuer={token.issuer} symbol={token.symbol} companySlug={company.slug} companyName={company.name} />
      </span></td>
    </tr>;
  };

  return <div className="app-shell"><MarketHeader />
    <main className="pc-page detail">
      <div className="pc-crumbs">
        <Link href="/" className="pc-back"><ChevronLeft size={16} />All companies</Link>
        <span>Markets</span><span aria-hidden>/</span>{company.sector && <><span>{company.sector}</span><span aria-hidden>/</span></>}<span className="current">{company.name}</span>
        <span className="pc-spacer" />
        <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={refresh} disabled={coverage.refreshing}><RefreshCw size={14} className={coverage.refreshing ? "spinning" : ""} />Refresh</button>
      </div>
      {coverage.error && <div className="pc-notice" role="alert">{coverage.error} Showing the last successful read.</div>}

      <nav className="pc-switcher" aria-label="Switch company">
        {byValuation.map((item) => (
          <Link key={item.slug} href={`/company/${item.slug}`} className="pc-switch" aria-current={item.slug === slug ? "page" : undefined}>
            <strong>{item.name}</strong>
            <small>{formatPrice(item.offchainPrice)} · {compactUsd(item.totals.volume30dUsd)} 30d</small>
          </Link>
        ))}
      </nav>

      <div className="pc-detail-top">
        <aside className="pc-card pc-aside">
          <div className="pc-aside-id">
            <Mark name={company.name} logo={company.logo} size={48} />
            <div>
              <h1>{company.name}</h1>
              <div className="pc-aside-sub">{company.sector && <span>{company.sector}</span>}{rank > 0 && <span className="pc-badge">#{rank} by valuation</span>}</div>
            </div>
            <button type="button" className="pc-round-star" onClick={() => toggleWatch(company.slug)} aria-pressed={watched} aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}>
              <Star size={18} fill={watched ? "currentColor" : "none"} strokeWidth={1.75} />
            </button>
          </div>

          <div className="pc-aside-price">
            <span className="pc-label">{company.listed ? `Listed · ${company.listed.exchange} ${company.listed.ticker}` : "Off-chain price"}</span>
            <div className="line">
              <span className="big">{formatPrice(company.listed ? company.impliedSharePrice : company.offchainPrice)}</span>
              <ChangeBadge value={changeOver(company.history, DAY)} suffix="24h" />
            </div>
            <span className="note">{company.impliedValuation !== null ? `Markets imply ${compactUsd(company.impliedValuation)}` : "Market valuation unconfirmed"}{company.premium !== null ? ` · ${formatSignedPercent(company.premium)} vs off-chain` : ""}{company.listed ? (company.offchainValuationBasis === "price × shares" ? ` · off-chain price ${formatPrice(company.offchainPrice)}` : ` · pre-IPO price was ${formatPrice(company.offchainPrice)}`) : ""}</span>
          </div>

          <dl className="pc-stats">
            {stats.map((stat) => (
              <div className="pc-stat" key={stat.label}>
                <dt>{stat.label}{stat.hint && <InfoTip label={stat.label}>{stat.hint}</InfoTip>}</dt>
                <dd><strong className={stat.tone === "up" ? "pc-up" : stat.tone === "down" ? "pc-down" : undefined}>{stat.value}</strong>{stat.sub && <small>{stat.sub}</small>}</dd>
              </div>
            ))}
          </dl>

          <div className="pc-aside-actions">
            {lead?.tradeUrl && <a className="pc-btn pc-btn-primary" href={lead.tradeUrl} target="_blank" rel="noopener noreferrer">Trade on {VENUE_NAMES[lead.venue] ?? lead.venue}</a>}
            <RequestAccessLink companyName={company.name} variant="lite" />
            {website && <a className="pc-btn pc-btn-outline" href={website} target="_blank" rel="noopener noreferrer"><Globe2 size={15} />Website</a>}
          </div>
        </aside>

        <div className="pc-detail-main">
          <div className="pc-kpis">
            {kpis.map((kpi) => (
              <div className="pc-card pc-kpi" key={kpi.label}>
                <span className="pc-label">{kpi.label}</span>
                <strong className={kpi.tone === "up" ? "pc-up" : kpi.tone === "down" ? "pc-down" : undefined}>{kpi.value}</strong>
                <small>{kpi.sub}</small>
              </div>
            ))}
          </div>

          <section className="pc-card pc-chart-card" aria-label="Price history">
            <div className="pc-chart-head">
              <div>
                <h2 className="pc-h3">Price</h2>
                <span className="caption">{company.seriesMarket ? `Daily close · ${company.seriesMarket.label} on ${VENUE_NAMES[company.seriesMarket.venue] ?? company.seriesMarket.venue}, the most-traded market` : "Daily close of the most-traded market"}</span>
                {seriesChange !== null && <ChangeBadge value={seriesChange} suffix={`· ${range}D`} />}
              </div>
              <div className="pc-segment small" role="group" aria-label="Chart range">
                {([7, 30, 90] as const).map((days) => <Pill key={days} value={String(days)} current={String(range)} onPick={(value) => setRange(Number(value) as 7 | 30 | 90)}>{days}D</Pill>)}
              </div>
            </div>
            {series.length >= 2 ? <>
              <PriceChart points={series.map((point) => ({ at: point.at, price: point.close }))} label={company.seriesMarket?.label ?? "Price"} />
              <div className="pc-chart-foot">
                <span>{plural(series.length, "daily close")}{company.offchainPrice ? ` · off-chain price ${formatPrice(company.offchainPrice)}` : ""}</span>
                <span>{formatDate(series[0].at)} – {formatDate(series[series.length - 1].at)}</span>
              </div>
            </> : <DataState title="No price history yet" description="The most-traded market has fewer than two daily closes." />}
          </section>
        </div>
      </div>

      <section className="pc-card pc-trades" aria-labelledby="trades-h">
        <div className="pc-trades-head">
          <div>
            <h2 id="trades-h" className="pc-h2">Where {company.name} trades</h2>
            <p><strong>{compactUsd(totals.volume30dUsd)}</strong> over 30 days · {totals.openInterestUsd ? compactUsd(totals.openInterestUsd) : "no"} open interest · ~{compactUsd(totals.estFees30dUsd)} fees · {plural(company.rows.length, "market")} on {plural(company.venues.length, "venue")}{company.issuers.length ? ` · ${plural(company.issuers.length, "issuer token")}` : ""}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div className="pc-segment small" role="group" aria-label="Asset type">
              <Pill value="all" current={type} onPick={setType}>All<span className="pc-seg-count">{company.rows.length + company.issuers.length}</span></Pill>
              {company.perps > 0 && <Pill value="perp" current={type} onPick={setType}>Perp<span className="pc-seg-count">{company.perps}</span></Pill>}
              {spotCount > 0 && <Pill value="spot" current={type} onPick={setType}>Spot<span className="pc-seg-count">{spotCount}</span></Pill>}
            </div>
            {company.venues.length + new Set(company.issuers.map((token) => token.issuer)).size > 1 && <div className="pc-segment small" role="group" aria-label="Venue">
              <Pill value="all" current={venue} onPick={setVenue}>All venues</Pill>
              {company.venues.map((name) => <Pill key={name} value={name} current={venue} onPick={setVenue}>{VENUE_NAMES[name] ?? name}<span className="pc-seg-count">{company.rows.filter((row) => row.venue === name).length}</span></Pill>)}
              {[...new Set(company.issuers.map((token) => token.issuer))].map((name) => <Pill key={name} value={name} current={venue} onPick={setVenue}>{name}<span className="pc-seg-count">{company.issuers.filter((token) => token.issuer === name).length}</span></Pill>)}
            </div>}
          </div>
        </div>

        {shareSegments.length > 0 && <div className="pc-share">
          <div className="pc-share-bar" role="img" aria-label={`30-day volume share by market; the largest holds ${(shareSegments[0].share * 100).toFixed(0)}%`}>
            {shareSegments.map((segment) => <span key={segment.label} style={{ flex: Math.max(segment.share * 100, 0.8), background: segment.colour }} />)}
          </div>
          <div className="pc-share-legend">
            {shareSegments.map((segment) => <span key={segment.label}><i style={{ background: segment.colour }} />{segment.label} <strong>{segment.share < 0.01 ? "<1%" : `${(segment.share * 100).toFixed(0)}%`}</strong></span>)}
            <span className="end">Share of 30d volume</span>
          </div>
        </div>}

        <div className="pc-scroll">
          <table className="pc-table compact mk-tg" style={{ minWidth: 1220 }}>
            <caption className="sr-only">Every market trading {company.name}: perpetuals first, then spot pairs and issuer tokens.</caption>
            <thead><tr>
              <th>Exchange</th><th>Pair</th>
              {HEADERS.map((header) => {
                // With only spot rows showing, these two columns hold the token market cap and holders.
                const spotOnly = perpShown === 0 && spotShown > 0 ? SPOT_LABELS[header.key] : undefined;
                if (spotOnly) { return <th key={header.key} className="r">{spotOnly}</th>; }
                return <th key={header.key} className="r" aria-sort={sort === header.key ? direction < 0 ? "descending" : "ascending" : "none"}>
                  <span className="pc-th-inner">
                    <button type="button" className={`pc-sort ${sort === header.key ? "on" : ""}`} onClick={() => toggleSort(header.key)}>{header.label}<span aria-hidden>{sort === header.key ? direction < 0 ? "↓" : "↑" : ""}</span></button>
                    {header.hint && <InfoTip label={header.label}>{header.hint}</InfoTip>}
                  </span>
                </th>;
              })}
              <th className="r">Status</th>
            </tr></thead>
            {perpShown > 0 && <tbody className="mk-tg-body">
              <tr className="mk-tg-group"><th colSpan={9} scope="colgroup"><span className="mk-tg-in">
                <strong>Perpetuals</strong><span className="mk-tg-count">{perpShown}</span>
                <span className="mk-tg-note">Leveraged contracts settled in cash with funding. Price is compared with the median perp.</span>
              </span></th></tr>
              {perpRows.map(perpRow)}
              {offRows.length > 0 && <>
                <tr className="mk-tg-sub warn"><td colSpan={9}><span className="mk-tg-in">
                  <strong>Different unit basis</strong><span className="mk-tg-count">{offRows.length}</span>
                  <span className="mk-tg-note">Quotes about {company.offRatio ? `${company.offRatio.toFixed(1)}×` : "a multiple of"} the main price, so left out of the median.</span>
                </span></td></tr>
                {offRows.map(perpRow)}
              </>}
            </tbody>}
            {spotShown > 0 && <tbody className="mk-tg-body">
              <tr className="mk-tg-group"><th colSpan={9} scope="colgroup"><span className="mk-tg-in">
                <strong>Spot</strong><span className="mk-tg-count">{spotShown}</span>
                <span className="mk-tg-note">Tokens you hold outright. Price is compared with the off-chain share price.</span>
              </span></th></tr>
              {perpShown > 0 && <tr className="mk-tg-cols" aria-hidden>
                <td /><td /><td className="r">Price</td><td className="r">24h vol</td><td className="r">30d vol</td><td className="r">Market cap</td><td className="r">Holders</td><td className="r">Fees 30d</td><td className="r">Status</td>
              </tr>}
              {spotRows.map(spotRow)}
              {issuerRows.length > 0 && <>
                {spotRows.length > 0 && <tr className="mk-tg-sub"><td colSpan={9}><span className="mk-tg-in">
                  <strong>Issuer tokens</strong><span className="mk-tg-count">{issuerRows.length}</span>
                  <span className="mk-tg-note">Priced by each issuer and backed by its own holding, so left out of the median.</span>
                </span></td></tr>}
                {issuerRows.map(issuerRow)}
              </>}
            </tbody>}
            {!perpShown && !spotShown && <tbody><tr><td colSpan={9} className="pc-empty" style={{ height: "auto" }}>No markets match these filters.</td></tr></tbody>}
          </table>
        </div>
        <div className="pc-table-foot">
          <span>Funding APR is annualized; — means the venue doesn&apos;t report it. Fees are estimated over 30 days.</span>
          <span>{coverage.data ? `Markets read ${formatDate(coverage.data.updatedAt)} ${new Date(coverage.data.updatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        </div>
      </section>

      <div className="pc-card mk-derived"><DerivedPrice slug={company.slug} companyName={company.name} /></div>

      <section className="pc-trio">
        <div className="pc-card">
          <h3 className="pc-h3">Volume by venue</h3>
          {venueBars.length ? venueBars.map((bar) => {
            const share = totals.volume30dUsd > 0 ? bar.volume / totals.volume30dUsd : 0;
            return <div className="pc-vbar" key={bar.name}>
              <div className="pc-vbar-top"><span className="pc-xm-inline"><VenueLogo name={VENUE_NAMES[bar.name] ?? bar.name} size={18} />{VENUE_NAMES[bar.name] ?? bar.name} <em>· {plural(bar.count, "market")}</em></span>
                <span><strong>{compactUsd(bar.volume)}</strong> <small>{(share * 100).toFixed(1)}%</small></span></div>
              <span className="pc-vbar-track"><span style={{ width: `${Math.max(venueBars[0].volume > 0 ? bar.volume / venueBars[0].volume * 100 : 0, 1)}%`, background: venueColour.get(bar.name) }} /></span>
            </div>;
          }) : <p className="pc-list-empty">No venues list this company.</p>}
        </div>

        <div className="pc-card">
          <div className="pc-trio-head"><h3 className="pc-h3">Funding across perps</h3><span>APR · shorts paid ← → longs paid</span></div>
          {perps.length ? perps.map((row) => {
            const value = row.fundingRateAnnualized;
            const width = value === null ? 0 : Math.min(Math.abs(value) / maxFunding, 1) * 50;
            return <div className="pc-fund-row" key={`${row.venue}-${row.marketType}-${row.market}`}>
              <span title={row.label} className="pc-xm-inline"><ExchangeMark provider={row.provider} venue={VENUE_NAMES[row.venue] ?? row.venue} size={18} />{row.provider}{row.market.includes("XPERP") ? " (dated)" : ""}</span>
              <span className="pc-fund-track"><span style={{ left: `${value !== null && value > 0 ? 50 : 50 - width}%`, width: `${width}%`, background: value !== null && value > 0 ? "var(--up-bar)" : "var(--down-bar)" }} /></span>
              <span className={value === null ? "pc-flat" : value > 0 ? "pc-up" : value < 0 ? "pc-down" : "pc-flat"}>{fundingText(value)}</span>
            </div>;
          }) : <p className="pc-list-empty">No perpetual markets list this company.</p>}
        </div>

        <div className="pc-card">
          <h3 className="pc-h3">Asset types</h3>
          {(["perp", "spot"] as const).map((key) => {
            const count = key === "spot" ? spotCount : company.perps;
            return <div className="pc-issuer" key={key} style={{ opacity: count ? 1 : 0.55 }}>
              <span className={`pc-tag ${TYPE_INFO[key].tagClass}`}>{TYPE_INFO[key].tag}</span>
              <div><strong>{TYPE_INFO[key].name} <em>· {count ? plural(count, "market") : "none listed"}</em></strong><small>{TYPE_INFO[key].description}</small></div>
            </div>;
          })}
          {company.issuers.length > 0 && <div className="pc-issuer">
            <span className="pc-tag neutral">ISSUER</span>
            <div><strong>Issuer tokens <em>· {company.issuers.map((token) => token.issuer).join(", ")}</em></strong><small>Spot tokens priced by their issuer and backed 1:1 by the issuer&apos;s own holding. Shown with the spot markets above.</small></div>
          </div>}
        </div>
      </section>

      <section className="pc-card pc-records" ref={recordsRef} aria-labelledby="records-h">
        <div className="pc-records-head">
          <div><h2 id="records-h" className="pc-h2">{tab === "About" ? `About ${company.name}` : `${company.name} ${tab.toLowerCase()}`}</h2>
            <p>{tab === "Funding" ? "Disclosed rounds, amounts raised and post-money valuations." : tab === "News" ? "Recent coverage of the company." : tab === "Research" ? "Reports and analysis from published sources." : "Company profile and background."}</p></div>
          <div className="pc-segment small" role="tablist" aria-label="Company records">
            {records.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className="pc-seg" onClick={() => setTab(item)}>{item}</button>)}
          </div>
        </div>
        {tab === "About" ? <div className="about-copy"><p>{profile?.description ?? "No company description is available yet."}</p></div>
          : tab === "Funding" && funding.length ? <FundingTable rounds={funding} />
          : insights.loading && profile ? <DataState loading title="Loading company records" description="Fetching funding, news and research." />
          : tab === "Funding" ? <DataState title="No funding records available" description="No disclosed rounds have been published for this company." />
          : <ArticleList articles={(tab === "News" ? insights.data?.news : insights.data?.research) ?? []} kind={tab} />}
      </section>
    </main>
  </div>;
}
