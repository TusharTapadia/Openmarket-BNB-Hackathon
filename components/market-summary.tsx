"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatSignedPercent } from "@/app/data";
import { useRemoteData } from "@/hooks/use-market-data";
import { FearGreedGauge } from "@/components/fear-greed";
import { InfoTip } from "@/components/info-tip";
import { CompanyMark } from "@/components/company-mark";
import { ExchangeMark } from "@/components/exchange-mark";
import { compactUsd, fundingText, marketPrice, plural, VENUE_NAMES, type CompanyView } from "@/lib/coverage-view";
import type { FearGreed } from "@/lib/fear-greed";
import { historyIndex, marketChange, marketKey, type HistoryPayload } from "@/components/pro/pro-history";
import { useLastRounds } from "@/components/pro/pro-kit";
import { SkeletonInline, SkeletonLines, SkeletonList } from "@/components/skeleton";
import { Flash } from "@/components/flash";

/**
 * The row of summary cards under the header, and the status bar fixed to the
 * bottom of the window, shared by Lite and Pro. Lite gets numbers, the gauge
 * and short lists; Pro adds sparklines, a funding bar chart and a venue donut,
 * and reads daily history for the changes Lite leaves as a dash.
 *
 * Every class is prefixed `ms-` / `sb-` (app/summary.css); Pro's look is
 * layered on under `.pro` in app/pro.css.
 */

type FearGreedPayload = { fetchedAt: string; reading: FearGreed | null };

const UP = "var(--color-ok)";
const DOWN = "var(--color-bad)";
const PAGE = 5;
const DONUT_COLOURS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-6)", "var(--series-8)", "var(--series-7)", "var(--series-5)"];

function Chg({ value, arrow = true }: { value: number | null; arrow?: boolean }) {
  if (value === null || !Number.isFinite(value)) { return <span className="ms-chg flat">—</span>; }
  const flat = Math.abs(value) < 0.00005;
  const tone = flat ? "flat" : value > 0 ? "up" : "down";
  return <span className={`ms-chg ${tone}`}>{arrow && !flat ? (value > 0 ? "▲ " : "▼ ") : ""}{formatSignedPercent(value).replace(/^[+−]/, "")}</span>;
}

function Logo({ name, logo }: { name: string; logo: string | null }) {
  return <span className="ms-logo"><CompanyMark name={name} logo={logo} /></span>;
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) { return <span className="ms-chg flat">—</span>; }
  const low = Math.min(...values);
  const high = Math.max(...values);
  const line = values.map((value, index) => `${(index * 64 / (values.length - 1)).toFixed(1)},${(22 - (value - low) / (high - low || 1) * 20).toFixed(1)}`).join(" ");
  return <svg className="ms-spark" width="64" height="24" viewBox="0 0 64 24" aria-hidden><polyline points={line} fill="none" stroke={values[values.length - 1] >= values[0] ? "var(--color-ok)" : "var(--color-bad)"} strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

/** A plain SVG donut with a legend; no labels on the ring itself. */
function Donut({ slices }: { slices: { label: string; value: number; colour: string }[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) { return <span className="ms-chg flat">—</span>; }
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const arcs = slices.map((slice, position) => ({
    ...slice,
    length: slice.value / total * circumference,
    offset: slices.slice(0, position).reduce((sum, item) => sum + item.value / total * circumference, 0),
  }));
  return <div className="ms-donut">
    <svg viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="30-day volume share by venue">
      <g transform="rotate(-90 48 48)">
        {arcs.map((arc) => <circle key={arc.label} cx="48" cy="48" r={r} fill="none" stroke={arc.colour} strokeWidth="16" strokeDasharray={`${arc.length} ${circumference}`} strokeDashoffset={-arc.offset} />)}
      </g>
    </svg>
    <ul>{slices.map((slice) => <li key={slice.label}><i style={{ background: slice.colour }} /><span>{slice.label}</span><strong>{(slice.value / total * 100).toFixed(slice.value / total >= 0.1 ? 0 : 1)}%</strong></li>)}</ul>
  </div>;
}

export function MarketSummary({ companies, loading, variant, history = null }: {
  companies: CompanyView[];
  loading: boolean;
  variant: "lite" | "pro";
  /** Pro passes the daily history it already reads. */
  history?: HistoryPayload | null;
}) {
  const fear = useRemoteData<FearGreedPayload>("/api/fear-greed");
  const rounds = useLastRounds(variant === "lite" ? companies.map((company) => company.slug) : []);
  const [page, setPage] = useState(0);
  const pro = variant === "pro";
  const index = historyIndex(history);

  const markets = companies.flatMap((company) => company.rows.map((row) => ({ ...row, company })));
  const perps = markets.filter((market) => market.marketType === "perp");
  const openInterest = companies.reduce((sum, company) => sum + company.totals.openInterestUsd, 0);
  const volume24 = companies.reduce((sum, company) => sum + company.totals.volume24hUsd, 0);
  const offchain = companies.reduce((sum, company) => sum + (company.offchainValuation ?? 0), 0);

  // Total value is the off-chain valuation; its change is the valuation-weighted
  // move of each company's lead-market daily close. Only ratios of one market's
  // own closes are used, so it holds whether a venue quotes a share or a
  // valuation divided by notional shares.
  const value: number | null = offchain > 0 ? offchain : null;
  const moved = companies.filter((company) => (company.offchainValuation ?? 0) > 0 && company.history.length >= 2);
  const movedTotal = moved.reduce((sum, company) => sum + company.offchainValuation!, 0);
  const valueChange = movedTotal > 0 ? moved.reduce((sum, company) => sum + company.offchainValuation! / movedTotal * (company.history[company.history.length - 1] / company.history[company.history.length - 2] - 1), 0) : null;

  // Valuation-weighted 7-day move of the lead markets: the second index figure.
  const weighted = companies.filter((company) => (company.offchainValuation ?? 0) > 0 && company.history.length >= 8);
  const weightTotal = weighted.reduce((sum, company) => sum + company.offchainValuation!, 0);
  const index7 = weightTotal > 0 ? weighted.reduce((sum, company) => sum + company.offchainValuation! / weightTotal * (company.history[company.history.length - 1] / company.history[0] - 1), 0) : null;

  // Movers: Lite ranks companies by their lead market's daily move; Pro ranks
  // every market by its own, from daily candles.
  // Price: the market-implied share price where a market's basis is confirmed
  // (and for a listed company); otherwise the off-chain share price, with the
  // lead market's move as the change. Never a raw perp quote.
  const companyMovers = companies.map((company) => ({
    key: company.slug, href: `/company/${company.slug}`, name: company.name, logo: company.logo,
    sub: company.listed ? "implied share price" : company.impliedSharePrice !== null ? "implied share price" : "off-chain share price",
    tag: company.listed ? `Listed · ${company.listed.ticker}` : null,
    exchange: null as { provider: string; venue: string } | null,
    price: company.impliedSharePrice ?? company.offchainPrice, change: company.history.length >= 2 ? company.history[company.history.length - 1] / company.history[company.history.length - 2] - 1 : null,
    spark: company.history,
  }));
  const marketMovers = markets.map((market) => {
    const points = index.get(marketKey(market))?.points ?? [];
    return {
      key: marketKey(market), href: `/company/${market.company.slug}`, name: market.label, logo: market.company.logo,
      sub: `${market.company.name} · ${VENUE_NAMES[market.venue] ?? market.venue}`, tag: `${market.marketType.toUpperCase()} quote` as string | null,
      exchange: { provider: market.provider, venue: VENUE_NAMES[market.venue] ?? market.venue },
      price: market.price, change: marketChange(points, 1), spark: points.slice(-14).map((point) => point.close),
    };
  });
  const movers = (pro && history ? marketMovers : companyMovers)
    .filter((item) => item.change !== null)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
  const pages = Math.max(1, Math.ceil(movers.length / PAGE));
  const current = Math.min(page, pages - 1);

  // Derivatives: who is paying, weighted by open interest, and the prior-day
  // volume change from daily candles (Pro only; Lite has no daily volume).
  const longsPay = perps.filter((market) => (market.fundingRateAnnualized ?? 0) > 0).reduce((sum, market) => sum + (market.openInterestUsd ?? 0), 0);
  const shortsPay = perps.filter((market) => (market.fundingRateAnnualized ?? 0) < 0).reduce((sum, market) => sum + (market.openInterestUsd ?? 0), 0);
  const splitTotal = longsPay + shortsPay;
  let volumeChange: number | null = null;
  if (pro && history) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const byDay = new Map<string, number>();
    for (const market of history.markets) {
      for (const point of market.points) {
        if (point.at === todayKey || point.volumeUsd === null || point.volumeUsd === undefined) { continue; }
        byDay.set(point.at, (byDay.get(point.at) ?? 0) + point.volumeUsd);
      }
    }
    const days = [...byDay.keys()].sort();
    if (days.length >= 2) { volumeChange = byDay.get(days[days.length - 1])! / byDay.get(days[days.length - 2])! - 1; }
  }
  const fundBars = perps.filter((market) => market.fundingRateAnnualized !== null)
    .sort((a, b) => (b.openInterestUsd ?? 0) - (a.openInterestUsd ?? 0)).slice(0, 8);
  const maxFund = Math.max(0.0001, ...fundBars.map((market) => Math.abs(market.fundingRateAnnualized!)));

  const venueSlices = [...new Set(markets.map((market) => market.venue))].map((venue) => ({
    label: VENUE_NAMES[venue] ?? venue, value: markets.filter((market) => market.venue === venue).reduce((sum, market) => sum + (market.volume30dUsd ?? 0), 0),
  })).sort((a, b) => b.value - a.value);
  const donut = [...venueSlices.slice(0, 5), ...(venueSlices.length > 5 ? [{ label: "Other", value: venueSlices.slice(5).reduce((sum, slice) => sum + slice.value, 0) }] : [])]
    .filter((slice) => slice.value > 0).map((slice, position) => ({ ...slice, colour: slice.label === "Other" ? "var(--series-rest)" : DONUT_COLOURS[position] }));
  const latestRounds = companies.flatMap((company) => rounds[company.slug] ? [{ company, round: rounds[company.slug]! }] : [])
    .sort((a, b) => (b.round.date ?? "").localeCompare(a.round.date ?? ""));

  const reading = fear.data?.reading ?? null;
  const dash = loading ? <SkeletonInline width={64} height={16} /> : null;

  return <>
    <section className={`ms-row ${pro ? "ms-pro" : "ms-lite"}`} aria-label="Market summary">
      <div className="ms-card ms-status">
        <div className="ms-card-head">
          <span className="ms-title ms-title-tip">Market status<InfoTip label="How the Fear & Greed index works">
            Our Fear &amp; Greed index scores the pre-IPO market from 0 (extreme fear) to 100 (extreme greed). Crypto versions lean on social posts and search trends; this market has none of that, so we build it only from what the venues record each day for the companies we cover. It is the equal-weighted average of four parts, each 0–100 with 50 as normal: Momentum (the valuation-weighted market against its 30-day average), Volatility (10-day against 30-day swings; calmer than usual scores higher), Breadth (how many companies rose on the day) and Volume (traded volume against its 30-day average). Equal weights because nothing here shows one signal leads the others. Each part is scaled linearly, not ranked against its own history, because about three months of data is too short for a fair percentile. Funding and open interest are the clearest sentiment signals but have no stored history, so they sit beside the score instead of inside it. Bands: under 20 extreme fear, 20–39 fear, 40–59 neutral, 60–79 greed, 80+ extreme greed.
          </InfoTip></span>
          <Link href="/fear-greed" className="ms-more">Fear &amp; Greed index</Link>
          <p className="mk-note">One score from 0 (fear) to 100 (greed), built from the four readings below. 50 is a normal day.</p>
        </div>
        <div className="ms-status-body">
          <div className="ms-gauge">{reading ? <FearGreedGauge score={reading.score} /> : fear.loading ? <SkeletonInline width={120} height={66} /> : <span className="ms-chg flat">—</span>}</div>
          <dl className="ms-figures">
            <div><dt>Total value</dt><dd><strong>{dash ?? compactUsd(value)}</strong><Chg value={valueChange} /><small>off-chain · 1D move, weighted</small></dd></div>
            <div><dt>Pre-IPO index · 7D</dt><dd><strong><Chg value={index7} /></strong><small>lead markets, weighted</small></dd></div>
          </dl>
        </div>
        {reading && <ul className="ms-parts" aria-label="What makes up the score">
          {reading.components.map((part) => (
            <li key={part.key} title={part.reading}>
              <span className="ms-part-name">{part.label}</span>
              <span className="ms-part-bar" aria-hidden><i style={{ width: `${Math.max(2, Math.min(100, part.score))}%`, background: part.score < 40 ? "var(--color-bad)" : part.score < 60 ? "var(--color-accent)" : "var(--color-ok)" }} /></span>
              <span className="ms-part-score ms-num">{Math.round(part.score)}</span>
              <small className="ms-part-reading">{part.reading}</small>
            </li>
          ))}
        </ul>}
      </div>

      <div className="ms-card ms-movers">
        <div className="ms-card-head">
          <span className="ms-title">Top movers, 1D</span>
          {pages > 1 && <span className="ms-pager">
            <button type="button" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0} aria-label="Previous movers"><ChevronLeft size={14} /></button>
            <span className="ms-num">{current + 1}/{pages}</span>
            <button type="button" onClick={() => setPage(Math.min(pages - 1, current + 1))} disabled={current >= pages - 1} aria-label="Next movers"><ChevronRight size={14} /></button>
          </span>}
          <p className="mk-note">{pro ? "Markets with the largest move between their last two daily closes, up or down." : "Companies with the largest move between their last two daily closes, up or down."}</p>
        </div>
        {movers.length ? <ol className="ms-list">
          {movers.slice(current * PAGE, current * PAGE + PAGE).map((item, position) => (
            <li key={item.key}><Link href={item.href}>
              <span className="ms-rank">{current * PAGE + position + 1}</span>
              {item.exchange ? <ExchangeMark provider={item.exchange.provider} venue={item.exchange.venue} size={22} /> : <Logo name={item.name} logo={item.logo} />}
              <span className="ms-name"><strong>{item.name}{item.tag && <em className="ms-tag">{item.tag}</em>}</strong><small>{item.sub}</small></span>
              {pro && <Spark values={item.spark} />}
              <span className="ms-right"><Flash value={item.price} className="ms-num">{marketPrice(item.price)}</Flash><Chg value={item.change} /></span>
            </Link></li>
          ))}
        </ol> : loading || (pro && !history) ? <SkeletonList rows={5} label="Loading top movers" mark={24} /> : <p className="ms-empty">No daily closes to compare.</p>}
      </div>

      <div className="ms-card ms-deriv">
        <div className="ms-card-head"><span className="ms-title">Derivatives</span><span className="ms-sub">{plural(perps.length, "perp")}</span>
          <p className="mk-note">Open interest is money in open perp positions. When longs pay funding, traders lean bullish.</p></div>
        <dl className="ms-figures two">
          <div><dt>Open interest</dt><dd><strong>{dash ?? compactUsd(openInterest)}</strong></dd></div>
          <div><dt>24h volume</dt><dd><strong>{dash ?? compactUsd(volume24)}</strong>{pro && <><Chg value={volumeChange} /><small>last full day vs prior</small></>}</dd></div>
        </dl>
        <div className="ms-split">
          <div className="ms-split-labels"><span className="up">Longs pay {splitTotal > 0 ? `${(longsPay / splitTotal * 100).toFixed(0)}%` : "—"}</span><span className="down">Shorts pay {splitTotal > 0 ? `${(shortsPay / splitTotal * 100).toFixed(0)}%` : "—"}</span></div>
          <div className="ms-split-bar" role="img" aria-label="Open interest by which side pays funding">
            {splitTotal > 0 && <><span className="up" style={{ flex: longsPay }} /><span className="down" style={{ flex: shortsPay }} /></>}
          </div>
          <small>Share of perp open interest by funding sign</small>
        </div>
        {fundBars.length > 0 && <div className="ms-fund-wrap"><small>Funding APR · largest perps by open interest</small><div className="ms-fund" role="img" aria-label="Funding APR of the largest perps by open interest">
          {fundBars.map((market) => {
            const rate = market.fundingRateAnnualized!;
            return <span key={marketKey(market)} className="ms-fund-col" title={`${market.label} · ${fundingText(rate)}`}>
              <span className="ms-fund-up">{rate > 0 && <i style={{ height: `${rate / maxFund * 100}%`, background: UP }} />}</span>
              <span className="ms-fund-down">{rate < 0 && <i style={{ height: `${-rate / maxFund * 100}%`, background: DOWN }} />}</span>
            </span>;
          })}
        </div></div>}
      </div>

      <div className="ms-card ms-extra">
        {pro ? <>
          <div className="ms-card-head"><span className="ms-title">30D volume by venue</span>
            <p className="mk-note">Which exchanges carry the trading, by share of the last 30 days&apos; volume.</p></div>
          {donut.length ? <Donut slices={donut} /> : loading ? <SkeletonLines lines={4} label="Loading volume by venue" /> : <p className="ms-empty">—</p>}
        </> : <>
          <div className="ms-card-head"><span className="ms-title">Latest priced rounds</span>
            <p className="mk-note">The most recent funding round for each company and the valuation it set.</p></div>
          {latestRounds.length ? <ul className="ms-list plain">
            {latestRounds.map(({ company, round }) => <li key={company.slug}><Link href={`/company/${company.slug}`}>
              <Logo name={company.name} logo={company.logo} />
              <span className="ms-name"><strong>{company.name}{company.listed && <em className="ms-tag">Listed</em>}</strong><small>{round.name ?? "Round"} · {round.date ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(round.date)) : "—"}</small></span>
              <span className="ms-right"><span className="ms-num">{compactUsd(round.valuation)}</span></span>
            </Link></li>)}
          </ul> : loading || !companies.length || Object.keys(rounds).length === 0 ? <SkeletonList rows={4} label="Loading priced rounds" mark={24} /> : <p className="ms-empty">—</p>}
        </>}
      </div>
    </section>

    <div className="sb-spacer" aria-hidden />
    <div className={`sb-bar ${pro ? "sb-pro" : ""}`} role="status" aria-label="Market totals">
      <span>Companies <strong>{dash ?? companies.length}</strong></span>
      <span>Markets <strong>{dash ?? markets.length}</strong></span>
      <span>Total value <strong>{dash ?? compactUsd(value)}</strong> <Chg value={valueChange} /></span>
      <span>24h vol <strong>{dash ?? compactUsd(volume24)}</strong>{pro && <> <Chg value={volumeChange} /></>}</span>
      <span>Open interest <strong>{dash ?? compactUsd(openInterest)}</strong></span>
      <span>Fear &amp; Greed <strong>{reading ? `${reading.score} · ${reading.band}` : fear.loading ? <SkeletonInline width={48} /> : "—"}</strong></span>
    </div>
  </>;
}
