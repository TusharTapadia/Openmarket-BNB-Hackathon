"use client";

import { Fragment, useState } from "react";
import type { FeedComponent, FeedSource } from "@/lib/data-feeds";
import { ExchangeMark } from "@/components/exchange-mark";
import { ago, compact, money, signedPct } from "./shared";

/** Verified data sources: every source behind a feed, its market, price, freshness and weight. */

const STATUS: Record<FeedSource["status"], { text: string; tone: string }> = {
  included: { text: "Active", tone: "df-pill-ok" },
  outlier: { text: "Outlier", tone: "df-pill-warn" },
  excluded: { text: "Excluded", tone: "df-pill-muted" },
};

function sourceOrder(source: FeedSource): number {
  if (source.kind === "listing" && source.venue === "Nasdaq") { return 0; }
  if (source.kind === "atlas") { return 1; }
  if (source.kind === "offchain") { return 2; }
  if (source.kind === "cmc") { return 3; }
  return 4;
}

function Row({ source, now }: { source: FeedSource; now: number }) {
  const status = STATUS[source.status];
  // Only when the per-share price really differs from the quote (not float noise from the 1:1 case).
  const rescaled = source.price !== null && source.rawPrice > 0 && Math.abs(source.price / source.rawPrice - 1) > 0.0005;
  return <tr className={source.status === "included" ? undefined : "df-row-out"}>
    <td data-label="Status"><span className={`df-pill ${status.tone}`}>{status.text}</span></td>
    <th scope="row" className="df-src">
      <span className="df-src-cell">
        <ExchangeMark provider={source.venue} venue={source.operator} size={26} />
        <span className="df-src-text">
          <strong>{source.venue}</strong>
          {source.operator && <small>{source.operator}</small>}
        </span>
      </span>
    </th>
    <td data-label="Market" className="df-market">
      <span className="df-num df-market-name" title={source.market}>{source.market}</span>
      {source.status !== "included" && <small className="df-why">{source.note}</small>}
    </td>
    <td data-label="24h volume" className="df-r df-hide-md">
      {source.volume24h !== null ? <span className="df-num">{compact(source.volume24h)}</span>
        : source.liquidityUsd !== null ? <><span className="df-num">{compact(source.liquidityUsd)}</span><small>liquidity</small></>
        : <span className="df-faint">—</span>}
    </td>
    <td data-label="Price" className="df-r">
      <span className="df-num">{money(source.price ?? source.rawPrice)}</span>
      {rescaled && <small title={`Quoted ${money(source.rawPrice)}, ${source.rawUnit}`}>from {money(source.rawPrice)}</small>}
      {source.price === null && <small>{source.rawUnit}</small>}
    </td>
    <td data-label="Last updated" className="df-r df-num df-hide-sm">{now ? ago(source.updatedAt, now) : "—"}</td>
    <td data-label="Weight" className="df-r df-weight">
      {source.status === "included" ? <>
        <span className="df-num">{(source.weightShare * 100).toFixed(1)}%</span>
        <span className="df-bar" aria-hidden><span style={{ width: `${Math.max(source.weightShare * 100, 1.5)}%` }} /></span>
      </> : <span className="df-faint df-num">{signedPct(source.deviation, 1)}</span>}
      <small className="df-wmethod">{source.weightMethod}</small>
    </td>
  </tr>;
}

/** One exchange market inside an aggregate source, listed for reading: it carries no weight of its own here. */
function ComponentRow({ component, parent, now, only }: { component: FeedComponent; parent: string; now: number; only: boolean }) {
  const active = component.status.toLowerCase() === "active";
  return <tr className="df-row-sub">
    <td data-label="Status"><span className={`df-pill ${active ? "df-pill-ok" : "df-pill-muted"}`}>{active ? "Active" : component.status.charAt(0).toUpperCase() + component.status.slice(1)}</span></td>
    <th scope="row" className="df-src">
      <span className="df-src-cell df-src-sub">
        <ExchangeMark provider={component.exchange} venue={null} size={22} />
        <span className="df-src-text"><strong>{component.exchange}</strong><small>inside {parent}</small></span>
      </span>
    </th>
    <td data-label="Market" className="df-market"><span className="df-num df-market-name" title={component.market}>{component.market}</span></td>
    <td data-label="24h volume" className="df-r df-num df-hide-md">{compact(component.volume24h)}</td>
    <td data-label="Price" className="df-r"><span className="df-num">{money(component.price)}</span><small>token price</small></td>
    <td data-label="Last updated" className="df-r df-num df-hide-sm">{now && component.updatedAt ? ago(component.updatedAt, now) : "—"}</td>
    <td data-label="Weight" className="df-r df-weight">
      {/* A share of the aggregator's own price, not of this feed: the aggregator row above carries the feed weight. */}
      {only ? <span className="df-muted">{parent}&apos;s only market</span> : <span className="df-num">{component.weighting === null ? "—" : `${(component.weighting * 100).toFixed(1)}% of ${parent}`}</span>}
      <small className="df-wmethod">counted once, inside {parent}</small>
    </td>
  </tr>;
}

export function SourcesTable({ sources, now, headingId }: { sources: FeedSource[]; now: number; headingId: string }) {
  const [showAll, setShowAll] = useState(false);
  const active = sources.filter((source) => source.status === "included");
  const rest = sources.filter((source) => source.status !== "included");
  const rows = (showAll ? [...active, ...rest] : active).sort((a, b) => sourceOrder(a) - sourceOrder(b));
  return <section className="df-card" aria-labelledby={headingId}>
    <header className="df-card-head">
      <h2 id={headingId}>Verified data sources</h2>
      <span className="df-count">{active.length} active of {sources.length}</span>
    </header>
    <div className="df-table-wrap">
      <table className="df-table df-sources">
        <thead><tr>
          <th scope="col">Status</th>
          <th scope="col">Data source</th>
          <th scope="col">Market</th>
          <th scope="col" className="df-r df-hide-md">24h volume</th>
          <th scope="col" className="df-r">Price per share</th>
          <th scope="col" className="df-r df-hide-sm">Last updated</th>
          <th scope="col" className="df-r">Weight</th>
        </tr></thead>
        <tbody>{rows.map((source) => <Fragment key={source.id}>
          <Row source={source} now={now} />
          {source.components.map((component) => <ComponentRow key={`${source.id}:${component.exchange}:${component.market}`} component={component} parent={source.venue} now={now} only={source.components.length === 1} />)}
        </Fragment>)}</tbody>
      </table>
    </div>
    {rest.length > 0 && <button type="button" className="df-link" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
      {showAll ? "Hide" : "Show"} {rest.length} outlier{rest.length === 1 ? "" : "s"} and excluded
    </button>}
  </section>;
}
