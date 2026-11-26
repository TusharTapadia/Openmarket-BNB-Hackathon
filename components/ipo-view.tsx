"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPrice } from "@/app/data";
import { useRemoteData } from "@/hooks/use-market-data";
import { compactUsd } from "@/lib/coverage-view";
import type { IpoAtlas, IpoCompany, IssuerIpo, Step } from "@/lib/post-ipo";
import { CompanyMark } from "@/components/company-mark";
import { ExchangeMark } from "@/components/exchange-mark";
import { InfoTip } from "@/components/info-tip";
import { SkeletonChart, SkeletonLines } from "@/components/skeleton";

/**
 * Pre-IPO → IPO: for each covered company that has listed, how each issuer's
 * pre-IPO token trades against the public stock while the shares behind it are
 * still locked up. Shared by Lite and Pro (app/ipo/page.tsx); Lite adds its own
 * left list of listed companies, Pro lists them in the sidebar.
 */

type Payload = { fetchedAt: string; companies: IpoCompany[] };

const pct = (value: number) => value === 0 ? "0%" : `${(value * 100).toFixed(1)}%`;
/** "PreStocks'" and "OpenStocks'", not "PreStocks's". */
const of = (name: string) => name.endsWith("s") ? `${name}'` : `${name}'s`;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const shortDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const holders = new Intl.NumberFormat("en-US");

/** The chart's rows: one per schedule step, starting today, with the current discount as a level. */
function chartRows(schedule: Step[] | null): { date: string; mark: number | null }[] {
  const today = new Date().toISOString().slice(0, 10);
  if (!schedule?.length) { return []; }
  const start = schedule.filter((step) => step.date <= today).pop() ?? schedule[0];
  const ahead = schedule.filter((step) => step.date > today);
  const rows = [{ date: today > start.date ? today : start.date, mark: start.discount }, ...ahead.map((step) => ({ date: step.date, mark: step.discount }))];
  // Hold the last step a few weeks so the end of the lock-up reads as a level, not a point.
  const last = rows[rows.length - 1];
  const after = new Date(Date.parse(`${last.date}T00:00:00Z`) + 24 * 86_400_000).toISOString().slice(0, 10);
  return [...rows, { date: after, mark: last.mark }];
}

function DiscountChart({ issuer, reference, current, publicToken }: { issuer: string; reference: Step[] | null; current: number; publicToken: { symbol: string; discount: number } | null }) {
  const rows = chartRows(reference);
  const top = Math.max(0.4, Math.ceil((Math.max(current, publicToken?.discount ?? 0, ...rows.map((row) => row.mark ?? 0)) + 0.05) * 20) / 20);
  if (!rows.length) {
    return <div className="ipo-chart-empty">No unlock schedule published, so only the current discount can be shown.</div>;
  }
  return <div className="ipo-chart" role="img" aria-label={`${issuer}: mark discount stepping from ${pct(rows[0].mark ?? 0)} to ${pct(rows[rows.length - 1].mark ?? 0)} by ${day(rows[rows.length - 2].date)}; current discount ${pct(current)}${publicToken ? `; ${publicToken.symbol} discount ${pct(publicToken.discount)}` : ""}`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 280 }}>
      <LineChart data={rows} margin={{ top: 12, right: 28, left: 4, bottom: 4 }}>
        <CartesianGrid stroke="var(--color-rule)" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--color-rule-2)" }} minTickGap={36} />
        <YAxis reversed domain={[0, top]} ticks={Array.from({ length: Math.round(top / 0.1) + 1 }, (_, index) => Math.round(index * 10) / 100)} interval={0} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} tick={{ fill: "var(--color-muted)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--color-rule-2)" }} width={44} />
        <Tooltip contentStyle={{ borderRadius: 6, border: "1px solid var(--color-rule-2)", background: "var(--color-paper-2)", color: "var(--color-ink)", fontSize: 12 }}
          labelFormatter={(value) => day(String(value))} formatter={(value) => [pct(Number(value)), "Mark discount"]} />
        <ReferenceLine y={current} stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="6 5" ifOverflow="extendDomain" />
        {publicToken && <ReferenceLine y={publicToken.discount} stroke="var(--color-ok)" strokeWidth={2} strokeDasharray="2 4" ifOverflow="extendDomain" />}
        <Line type="stepAfter" dataKey="mark" stroke="var(--color-cool)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

function IssuerPanel({ item, company, reference }: { item: IssuerIpo; company: IpoCompany; reference: { schedule: Step[] | null; from: string } }) {
  const markPrice = item.markDiscount !== null ? item.reference.price * (1 - item.markDiscount) : null;
  const end = item.schedule?.length ? item.schedule[item.schedule.length - 1] : null;
  const vsMark = item.markDiscount !== null ? item.currentDiscount - item.markDiscount : null;
  const publicGap = item.publicToken?.discount ?? null;
  const publicRef = item.publicToken?.reference ?? company.sharePrice;
  const publicLine = item.publicToken && publicGap !== null ? { symbol: item.publicToken.symbol, discount: publicGap } : null;
  const borrowed = !item.schedule && reference.schedule;

  return <article className="ipo-issuer" aria-labelledby={`ipo-${item.issuer}`}>
    <header className="ipo-issuer-head">
      <ExchangeMark provider={item.issuer} venue={null} size={32} />
      <div className="ipo-issuer-id">
        <h3 id={`ipo-${item.issuer}`}>{item.issuer}</h3>
        <span>{item.token.symbol}{item.publicToken ? ` → ${item.publicToken.symbol}` : ""}</span>
      </div>
      <a className="ipo-link" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.issuer} in a new tab`}>Open {item.issuer}<ExternalLink size={12} aria-hidden /></a>
    </header>

    <div className="ipo-stats">
      <div className="ipo-stat">
        <span className="ipo-stat-label"><i className="ipo-key current" aria-hidden />Current discount</span>
        <strong>{pct(item.currentDiscount)}</strong>
        <small>{item.token.symbol} at {formatPrice(item.token.price)}</small>
      </div>
      {publicLine && item.publicToken && <div className="ipo-stat">
        <span className="ipo-stat-label"><i className="ipo-key public" aria-hidden />{item.publicToken.symbol} discount</span>
        <strong>{pct(publicLine.discount)}</strong>
        <small>{formatPrice(item.publicToken.price)} vs {formatPrice(publicRef)}</small>
      </div>}
      <div className="ipo-stat">
        <span className="ipo-stat-label"><i className="ipo-key mark" aria-hidden />Mark discount</span>
        <strong className={item.markDiscount === null ? "ipo-none" : undefined}>{item.markDiscount === null ? "Not published" : pct(item.markDiscount)}</strong>
        <small>{markPrice !== null ? `conversion at ${formatPrice(markPrice)}` : `${item.issuer} publishes no schedule`}</small>
      </div>
      <div className="ipo-stat">
        <span className="ipo-stat-label">Measured against</span>
        <strong>{formatPrice(item.reference.price)}</strong>
        <small>{item.reference.label}</small>
      </div>
    </div>

    <DiscountChart issuer={item.issuer} reference={item.schedule ?? reference.schedule} current={item.currentDiscount} publicToken={publicLine} />
    {borrowed && <p className="ipo-borrowed">The step line is {of(reference.from)} published unlock schedule for {company.name}&apos;s shares, shown for reference: {item.issuer} has not published its own.</p>}

    <div className="ipo-read">
      <p>
        {item.token.symbol} trades at <strong>{formatPrice(item.token.price)}</strong>, <strong>{pct(item.currentDiscount)} below</strong> its public value of {formatPrice(item.reference.price)}
        {item.sharesPerToken && item.sharesPerToken > 1.05 ? ` (one token stands for ${Number.isInteger(item.sharesPerToken) ? item.sharesPerToken : `about ${item.sharesPerToken.toFixed(1)}`} ${company.ticker} shares)` : ""}.
        {vsMark !== null && (vsMark < 0
          ? ` That is ${pct(-vsMark)} less than ${of(item.issuer)} own mark of ${pct(item.markDiscount!)}, so buyers are paying above the conversion price for the option to sell before the lock-up ends.`
          : ` That is ${pct(vsMark)} more than ${of(item.issuer)} own mark of ${pct(item.markDiscount!)}, so the token can be bought below what ${item.issuer} pays on conversion.`)}
      </p>
      {end && <p>The mark discount steps down as each tranche of shares unlocks and reaches {pct(end.discount)} on {day(end.date)}, when the token converts into stock at the full public price.</p>}
      {item.publicToken && <p>
        Its public token {item.publicToken.symbol}, the token {item.token.symbol} converts into, trades at {formatPrice(item.publicToken.price)}{publicGap !== null ? `, ${publicGap >= 0 ? `${pct(publicGap)} below` : `${pct(-publicGap)} above`} its ${formatPrice(publicRef)} public value (the dotted line)` : ""}
        {item.publicToken.volume24h !== null ? `, with ${compactUsd(item.publicToken.volume24h)} traded in the last 24 hours` : ""}{item.publicToken.holders ? ` across ${holders.format(item.publicToken.holders)} holders` : ""}.
      </p>}
    </div>

    <dl className="ipo-meta">
      <div><dt>Holders</dt><dd>{item.token.holders ? holders.format(item.token.holders) : "—"}</dd></div>
      <div><dt>24h volume</dt><dd>{item.token.volume24h !== null ? compactUsd(item.token.volume24h) : "—"}</dd></div>
      <div><dt>Token market cap</dt><dd>{item.token.tokenMarketCap ? compactUsd(item.token.tokenMarketCap) : "—"}</dd></div>
    </dl>
  </article>;
}

const signedPct = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(2)}%`;
const ago = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return seconds < 90 ? `${seconds}s ago` : seconds < 5400 ? `${Math.round(seconds / 60)}m ago` : `${Math.round(seconds / 3600)}h ago`;
};

/** The Atlas oracle's price for the company's public-share token, against the public share price. */
function AtlasRow({ atlas, company }: { atlas: IpoAtlas; company: IpoCompany }) {
  const active = atlas.sources.filter((source) => source.status === "active");
  const volume = active.reduce((sum, source) => sum + (source.volume24h ?? 0), 0);
  return <section className="ipo-atlas" aria-labelledby={`ipo-atlas-${atlas.symbol}`}>
    <header className="ipo-atlas-head">
      <div className="ipo-atlas-id">
        <h2 id={`ipo-atlas-${atlas.symbol}`}>{atlas.symbol} on Atlas</h2>
        <span>{atlas.feedName} · {atlas.method.includes("VOLUME-WEIGHT") ? "volume-weighted" : "aggregate"} oracle price, one token per {company.ticker} share</span>
      </div>
      <a className="ipo-link" href={atlas.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${atlas.symbol} feed on Atlas in a new tab`}>Atlas feed<ExternalLink size={12} aria-hidden /></a>
    </header>
    <dl className="ipo-atlas-stats">
      <div><dt>Aggregate price</dt><dd>{formatPrice(atlas.price)}</dd><small>updated {ago(atlas.updatedAt)}</small></div>
      <div><dt>vs {company.ticker}</dt><dd className={atlas.premium === null ? undefined : atlas.premium >= 0 ? "ipo-up" : "ipo-down"}>{atlas.premium === null ? "—" : signedPct(atlas.premium)}</dd><small>{atlas.premium === null ? "no share price" : `${atlas.premium >= 0 ? "premium" : "discount"} to ${formatPrice(company.sharePrice)}`}</small></div>
      <div><dt>Source volume, 24h</dt><dd>{volume > 0 ? compactUsd(volume) : "—"}</dd><small>{active.length} {active.length === 1 ? "exchange" : "exchanges"}{atlas.consensusStatus ? `, consensus ${atlas.consensusStatus.toLowerCase()}` : ""}</small></div>
    </dl>
    {atlas.sources.length > 0 && <ul className="ipo-atlas-sources" aria-label={`${atlas.symbol} source exchanges`}>
      {atlas.sources.map((source) => <li key={`${source.exchange}-${source.market}`} className={source.status === "active" ? undefined : "is-out"}>
        <ExchangeMark provider={source.exchange} venue={null} size={18} />
        <span className="ipo-atlas-ex">{source.exchange}</span>
        <span className="ipo-atlas-num">{formatPrice(source.price)}</span>
        <span className="ipo-atlas-num">{source.volume24h ? compactUsd(source.volume24h) : "—"}</span>
        <span className="ipo-atlas-num">{source.weighting !== null ? pct(source.weighting) : source.status}</span>
      </li>)}
    </ul>}
  </section>;
}

export function IpoView({ variant }: { variant: "lite" | "pro" }) {
  const { data, loading, error } = useRemoteData<Payload>("/api/ipo");
  const companies = data?.companies ?? [];
  // The company lives in the URL (/ipo?company={slug}), so the Pro sidebar links,
  // the Lite list, back/forward and a shared link all pick the same one.
  const slug = useSearchParams().get("company");
  const router = useRouter();
  const setSlug = (next: string) => router.replace(`/ipo?company=${encodeURIComponent(next)}`, { scroll: false });
  const company = companies.find((item) => item.slug === slug) ?? companies[0] ?? null;
  const reference = (() => {
    const published = company?.issuers.find((item) => item.schedule?.length);
    return { schedule: published?.schedule ?? null, from: published?.issuer ?? "" };
  })();

  const body = loading ? <div className="ipo-body"><SkeletonLines lines={3} label="Loading post-IPO data" /><SkeletonChart height={280} label="Loading discount chart" /></div>
    : error && !companies.length ? <p className="ipo-empty">Post-IPO data is unavailable right now. Try again shortly.</p>
    : !company ? <p className="ipo-empty">No covered company has listed yet.</p>
    : <div className="ipo-body">
      <section className="ipo-hero" aria-labelledby="ipo-h">
        <span className="ipo-logo"><CompanyMark name={company.name} logo={null} /></span>
        <div className="ipo-hero-text">
          <h1 id="ipo-h">{company.name} <span className="ipo-arrow">pre-IPO → IPO</span></h1>
          <p>Listed on {company.exchange} as <strong>{company.ticker}</strong> on {day(company.since)}. <a href={company.source} target="_blank" rel="noopener noreferrer">Listing notice<ExternalLink size={12} aria-hidden /></a></p>
        </div>
        <div className="ipo-share">
          <span>Public share price</span>
          <strong>{formatPrice(company.sharePrice)}</strong>
          <small>{company.ticker}, as PreStocks quotes it</small>
        </div>
      </section>

      {company.atlas && <AtlasRow atlas={company.atlas} company={company} />}

      <section className="ipo-explain" aria-label="Why pre-IPO tokens trade at a discount">
        <div className="ipo-explain-cell">
          <h2>Why the tokens trade at a discount</h2>
          <p>Shares bought before an IPO stay under a company-enforced lock-up after the listing. Until they unlock they cannot be delivered as conversion liquidity, so a pre-IPO token cannot yet be swapped for public stock and trades below the public price.</p>
        </div>
        <div className="ipo-explain-cell">
          <h2>How to read the chart <InfoTip label="Current and mark discount">Current discount is where the token trades now against its public value. Mark discount is what the issuer applies when it provides conversion liquidity; it falls each time a tranche of shares unlocks and reaches zero when the lock-up ends. The chart puts 0% at the top, so the line climbing means the discount narrowing.</InfoTip></h2>
          <p><i className="ipo-key mark" aria-hidden /> The step line is the <strong>mark discount</strong>, stepping toward 0% as shares unlock. <i className="ipo-key current" aria-hidden /> The dashed line is the <strong>current discount</strong> the token trades at today. <i className="ipo-key public" aria-hidden /> Where an issuer has a public token, the dotted line is that token&apos;s discount to its public value. When the dashed line sits below the step line, the discount is bigger than the mark and the token is cheaper than the issuer&apos;s conversion price; above it, dearer.</p>
        </div>
        <div className="ipo-explain-cell">
          <h2>Selling before the lock-up ends</h2>
          <p>A private shareholder waits out the whole lock-up. A token holder can sell part or all of a position early instead, at whatever discount the market is paying that day.</p>
        </div>
      </section>

      <div className="ipo-issuers">
        {company.issuers.length ? company.issuers.map((item) => <IssuerPanel key={item.issuer} item={item} company={company} reference={reference} />)
          : <p className="ipo-empty">Neither issuer has published post-IPO figures for {company.name} yet.</p>}
      </div>
      <p className="ipo-foot">PreStocks figures are as PreStocks publishes them. OpenStocks&apos; token prices, holders and volume are read on-chain on BNB Chain through GeckoTerminal; oANTHROPIC is measured against $830 (10 ANT shares at $83) and oANTHROPICx against $83, fixed values set for this page. Atlas prices are the oracle&apos;s own aggregate of the exchanges it verifies, read from atlasoracle.io. Refreshed every ten minutes. For information only, not investment advice.</p>
    </div>;

  if (variant === "pro") { return <main className="p-wrap p-main ipo pro-ipo">{body}</main>; }
  return <main className="pc-page ipo-page">
    <div className="ipo-layout">
      <nav className="ipo-side" aria-label="Pre-IPO to IPO">
        <h2>Pre-IPO → IPO</h2>
        <p>Covered companies that have listed.</p>
        <ul>{loading ? <li><SkeletonLines lines={1} label="Loading listed companies" /></li> : companies.map((item) => <li key={item.slug}>
          <button type="button" className="ipo-side-item" aria-current={item.slug === company?.slug ? "page" : undefined} onClick={() => setSlug(item.slug)}>
            <span className="ipo-side-logo"><CompanyMark name={item.name} logo={null} /></span>
            <span className="ipo-side-text"><strong>{item.name}</strong><small>{item.exchange} {item.ticker}, since {day(item.since)}</small></span>
          </button>
        </li>)}</ul>
      </nav>
      <div className="ipo-main">{body}</div>
    </div>
  </main>;
}
