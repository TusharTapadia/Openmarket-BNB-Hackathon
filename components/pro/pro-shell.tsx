"use client";

import { BrandMark } from "@/components/brand-mark";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { BarChart3, ChevronsLeft, ChevronsRight, FileText, Gauge, LayoutDashboard, LayoutGrid, LineChart, Menu, Radio, RefreshCw, Search, Star, Table2, X } from "lucide-react";
import { compactUsd, LISTED, marketPrice, TYPE_INFO } from "@/lib/coverage-view";
import { CompanyMark } from "@/components/company-mark";
import { ExchangeMark } from "@/components/exchange-mark";
import { ViewToggle } from "@/components/view-mode";
import { ThemeToggle } from "@/components/theme-mode";
import { HEAT_MAP_ENABLED } from "@/components/heat-map";
import { SkeletonInline } from "@/components/skeleton";
import { Flash } from "@/components/flash";
import { IST_TIME, PChg, seriesChange, useProData, venueName } from "./pro-kit";
import { historyIndex, marketChange, marketKey, useHistory, type HistoryPayload } from "./pro-history";

/**
 * The frame every Pro page sits in: a status bar, a slim header with search
 * and the Lite/Pro switch, two scrolling ticker rows, and a sectioned left
 * sidebar (collapsible to icons; a drawer on narrow screens).
 */

export type ProActive = "home" | "screener" | "watchlist" | "report" | "ipo" | `ipo:${string}` | "data-feeds" | "perp" | "spot" | `company:${string}`;

const COLLAPSE_KEY = "markets-pro-sidebar";

/** A company logo, clipped round. */
export function Logo({ name, logo, size = 22 }: { name: string; logo: string | null; size?: number }) {
  return <span className="p-logo" style={{ width: size, height: size }}><CompanyMark name={name} logo={logo} /></span>;
}

type TickerItem = { key: string; href: string; render: () => ReactNode };

/**
 * A ticker row that loops without a seam: the items are drawn twice and the
 * track slides by half its width. The second copy (and any repeats needed to
 * fill a wide screen) is hidden from screen readers and from the tab order.
 * Reduced motion turns it back into a static, scrollable strip.
 */
function Marquee({ label, items, reverse = false, seconds, loading = false }: { label: string; items: TickerItem[]; reverse?: boolean; seconds: number; loading?: boolean }) {
  const repeats = items.length ? Math.max(1, Math.ceil(12 / items.length)) : 1;
  const set = (copy: number) => Array.from({ length: repeats }, (_, round) => items.map((item) => {
    const hidden = copy > 0 || round > 0;
    return <Link key={`${copy}-${round}-${item.key}`} href={item.href} className="p-tick" tabIndex={hidden ? -1 : undefined} aria-hidden={hidden || undefined} data-dup={hidden ? "" : undefined}>{item.render()}</Link>;
  }));
  return <div className="p-tape-row">
    <span className="p-lbl p-tape-label">{label}</span>
    <div className="p-marquee">
      {items.length ? <div className={`p-marquee-track ${reverse ? "rev" : ""}`} style={{ "--p-dur": `${seconds}s` } as CSSProperties}>
        <div className="p-marquee-set">{set(0)}</div>
        <div className="p-marquee-set" aria-hidden data-dup="">{set(1)}</div>
      </div> : <span className="p-tick">{loading ? <SkeletonInline width={520} height={10} /> : <span className="p-faint">—</span>}</span>}
    </div>
  </div>;
}

export function ProShell({ active, data, history, search, onNav, children }: {
  active: ProActive;
  data: ReturnType<typeof useProData>;
  /** Pass when the page already reads history, so the ticker does not fetch it twice. */
  history?: HistoryPayload | null;
  search?: { value: string; onChange: (value: string) => void };
  /** In-place switch for the screener's Screener / Watchlist pair. */
  onNav?: (key: "screener" | "watchlist") => void;
  children: ReactNode;
}) {
  const { companies, markets, totals, data: payload, error, refreshing, refresh } = data;
  const own = useHistory(history === undefined);
  const index = historyIndex(history === undefined ? own.data : history);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    // Restore the sidebar width after hydration so the server render stays stable.
    const timer = setTimeout(() => { try { setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1"); } catch { /* storage off */ } }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!drawer) { return; }
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setDrawer(false); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  function toggleCollapsed() {
    setCollapsed((current) => {
      try { localStorage.setItem(COLLAPSE_KEY, current ? "0" : "1"); } catch { /* storage off */ }
      return !current;
    });
  }

  const asOf = payload ? IST_TIME.format(new Date(payload.updatedAt)) : null;
  const byVolume = [...companies].sort((a, b) => b.totals.volume30dUsd - a.totals.volume30dUsd);
  const topMarkets = [...markets].sort((a, b) => (b.volume30dUsd ?? 0) - (a.volume30dUsd ?? 0)).slice(0, 10);
  // Markets include the issuer tokens (OpenStocks, PreStocks, xStocks) as spot markets.
  const count = (type: "perp" | "spot") => markets.filter((market) => market.marketType === type).length;

  const companyTicks: TickerItem[] = byVolume.map((company) => ({
    key: company.slug, href: `/company/${company.slug}`,
    render: () => <><strong>{company.name}</strong><span className="p-mono">{compactUsd(company.totals.volume30dUsd)}</span><PChg value={seriesChange(company, 30)} arrow /></>,
  }));
  const marketTicks: TickerItem[] = topMarkets.map((market) => ({
    key: marketKey(market), href: `/company/${market.company.slug}`,
    render: () => {
      const change = marketChange(index.get(marketKey(market))?.points, 1);
      return <><ExchangeMark provider={market.provider} venue={venueName(market.venue)} size={16} /><strong className="p-mono">{market.label}</strong><Flash value={market.price} className="p-mono">{marketPrice(market.price)}</Flash>
        {change !== null && <PChg value={change} arrow />}<span className="p-faint">{venueName(market.venue)}</span></>;
    },
  }));

  type Item = { key: ProActive | "charts" | "fear-greed" | "heat-map"; label: string; href: string; icon: ReactNode; count?: number; inPlace?: "screener" | "watchlist" };
  const sections: { title: string; items: Item[] }[] = [
    { title: "Latest", items: [
      { key: "home", label: "Market Overview", href: "/", icon: <LayoutDashboard size={16} /> },
      ...(HEAT_MAP_ENABLED ? [{ key: "heat-map" as const, label: "Heat Map", href: "/#heat-map", icon: <LayoutGrid size={16} /> }] : []),
      { key: "screener", label: "Screener", href: "/screener", icon: <Table2 size={16} />, inPlace: "screener" },
      { key: "watchlist", label: "Watchlist", href: "/screener?view=watchlist", icon: <Star size={16} />, inPlace: "watchlist" },
      { key: "report", label: "Market Report", href: "/overview", icon: <FileText size={16} /> },
      { key: "fear-greed", label: "Fear & Greed", href: "/fear-greed", icon: <Gauge size={16} /> },
      { key: "charts", label: "Charts", href: "/charts", icon: <LineChart size={16} /> },
      { key: "data-feeds", label: "Data feeds", href: "/data-feeds", icon: <Radio size={16} /> },
    ] },
    // Covered companies that have listed: their pre-IPO tokens against the public stock.
    // A listed company we do not cover (SpaceX) carries its own name in LISTED.
    { title: "Pre-IPO → IPO", items: Object.entries(LISTED).flatMap(([slug, listing]) => {
      const company = companies.find((item) => item.slug === slug);
      const name = company?.name ?? listing.name;
      return name ? [{ key: `ipo:${slug}` as ProActive, label: name, href: `/ipo?company=${slug}`, icon: <Logo name={name} logo={company?.logo ?? null} size={20} /> }] : [];
    }) },
    { title: "Asset types", items: (["perp", "spot"] as const).map((type) => ({
      key: type, label: TYPE_INFO[type].name, href: `/?type=${type}#markets`, count: count(type),
      icon: <span className="p-type-dot" style={{ background: TYPE_INFO[type].colour }} />,
    })) },
    { title: "Companies", items: byVolume.map((company) => ({
      key: `company:${company.slug}` as ProActive, label: company.name, href: `/company/${company.slug}`, count: company.rows.length + company.issuers.length,
      icon: <Logo name={company.name} logo={company.logo} size={20} />,
    })) },
  ];

  const nav = (compact: boolean) => <nav className="p-side-nav" aria-label="Pro navigation">
    {sections.map((section) => <div key={section.title} className="p-side-section">
      <span className="p-lbl p-side-title">{compact ? "·" : section.title}</span>
      {section.items.map((item) => {
        const current = item.key === active;
        const body = <>
          <span className="p-side-icon">{item.icon}</span>
          <span className="p-side-label">{item.label}</span>
          {item.count !== undefined && <span className="p-mono p-side-count">{item.count}</span>}
        </>;
        if (onNav && item.inPlace) {
          const key = item.inPlace;
          return <button key={item.key} type="button" className="p-side-link" aria-current={current ? "page" : undefined} title={compact ? item.label : undefined}
            onClick={() => { onNav(key); setDrawer(false); }}>{body}</button>;
        }
        return <Link key={`${item.key}:${item.href}`} href={item.href} className="p-side-link" aria-current={current ? "page" : undefined} title={compact ? item.label : undefined}
          onClick={() => setDrawer(false)}>{body}</Link>;
      })}
    </div>)}
  </nav>;

  return <div className={`pro ${collapsed ? "p-collapsed" : ""}`}>
    <div className="p-util">
      <div className="p-util-inner">
        <span className="p-live"><i className={error ? "down" : ""} />{error ? "Delayed" : "Live"}</span>
        <span className="p-mono">{asOf ? `As of ${asOf} IST` : <SkeletonInline width={150} height={10} />}</span>
        <span className="p-util-src">Source: venue market data · {totals.providers.length || "—"} data providers · {totals.venues.length || "—"} venues{payload?.failedSources ? ` · ${payload.failedSources} sources unavailable` : ""}</span>
        <span className="p-grow" />
        <button type="button" className="p-util-btn" onClick={refresh} disabled={refreshing}><RefreshCw size={12} className={refreshing ? "spinning" : ""} />Refresh</button>
      </div>
    </div>
    <header className="p-header">
      <div className="p-header-inner">
        <button type="button" className="p-menu-btn" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer}><Menu size={18} /></button>
        <Link href="/" className="p-brand" aria-label="Openmarkets home">
          <span className="p-brand-mark"><BrandMark size={28} /></span>
          <span className="p-brand-name">Openmarkets</span>
          <span className="p-lbl">Private Markets Data · Pro</span>
        </Link>
        <span className="p-grow" />
        <div className="p-header-tools">
          {search && <label className="p-search">
            <Search size={15} aria-hidden />
            <input type="search" value={search.value} onChange={(event) => search.onChange(event.target.value)} placeholder="Search companies, markets" aria-label="Search companies and markets" />
            {search.value && <button type="button" onClick={() => search.onChange("")} aria-label="Clear search"><X size={13} /></button>}
          </label>}
          <ViewToggle tone="pro" />
          <ThemeToggle tone="pro" />
        </div>
      </div>
      <div className="p-tape" aria-label="Market ticker">
        <Marquee label="Companies · 30D" items={companyTicks} seconds={Math.max(36, companyTicks.length * 9)} loading={data.loading} />
        <Marquee label="Markets · 1D" items={marketTicks} reverse seconds={Math.max(80, marketTicks.length * 10)} loading={data.loading} />
      </div>
    </header>

    <div className="p-body">
      <aside className="p-sidebar" aria-label="Sidebar">
        {nav(collapsed)}
        <button type="button" className="p-collapse" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /><span>Collapse</span></>}
        </button>
      </aside>
      {drawer && <div className="p-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
        <button type="button" className="p-drawer-backdrop" aria-label="Close navigation" onClick={() => setDrawer(false)} />
        <div className="p-drawer-panel">
          <div className="p-row-between p-drawer-head"><span className="p-brand-name small">Openmarkets</span>
            <button type="button" className="p-menu-btn show" onClick={() => setDrawer(false)} aria-label="Close navigation"><X size={18} /></button></div>
          {nav(false)}
        </div>
      </div>}
      <div className="p-content">
        {children}
        <footer className="p-footer">
          <div className="p-wrap p-footer-inner">
            <span className="p-brand-name small">Openmarkets</span>
            <Link href="/">Market overview</Link>
            <Link href="/screener">Screener</Link>
            <Link href="/overview">Market report</Link>
            <span className="p-grow" />
            <span className="p-mono"><BarChart3 size={12} /> Data: venue market data{asOf ? ` · ${asOf} IST` : ""}</span>
          </div>
        </footer>
      </div>
    </div>
  </div>;
}
