"use client";

import Link from "next/link";
import "@/app/data-feeds.css";
import type { FeedSummary, Onchain } from "@/lib/data-feeds";
import { Mark, Spark } from "@/components/pc";
import { SkeletonInline, SkeletonTable } from "@/components/skeleton";
import { ContractsCard, OnchainCell, UPDATE_RULE, onchainFor } from "./onchain";
import { ContractChip } from "./contract-chip";
import { ago, bps, money, signedPct, useNow, usePoll } from "./shared";

/** Every asset's data feed in one table, with what the oracle holds for each. Shared by Lite and Pro. */

type Payload = { fetchedAt: string; feeds: FeedSummary[] };

export function FeedsIndex({ variant }: { variant: "lite" | "pro" }) {
  const { data, error, loading } = usePoll<Payload>("/api/data-feeds", 30_000);
  const chain = usePoll<Onchain>("/api/data-feeds/onchain", 30_000);
  const now = useNow(1000);
  const feeds = data?.feeds ?? [];
  const priced = feeds.filter((feed) => feed.price !== null);
  const sources = feeds.reduce((sum, feed) => sum + feed.sourcesUsed, 0);
  const onchain = chain.data;
  const pending = loading && !data;
  const chainPending = chain.loading && !onchain;

  const body = <>
    <section className="df-hero" aria-labelledby="df-title">
      <div className="df-hero-text">
        <h1 id="df-title">Data feeds</h1>
        <p>One price per share for each pre-IPO company, aggregated from every perp, spot market, issuer token and off-chain trade we read, and pushed to the PreIpoPriceOracle contract for anything on-chain to use.</p>
        <p className="df-rule">{UPDATE_RULE}</p>
      </div>
      <dl className="df-stats">
        <div><dt>Feeds</dt><dd className="df-num">{pending ? <SkeletonInline width={64} height={16} /> : data ? `${priced.length} of ${feeds.length}` : "—"}</dd></div>
        <div><dt>Sources in use</dt><dd className="df-num">{pending ? <SkeletonInline width={48} height={16} /> : data ? sources : "—"}</dd></div>
        <div><dt>Oracle</dt><dd>{chainPending ? <SkeletonInline width={88} height={16} /> : !onchain ? "Unavailable" : onchain.deployed ? onchain.error ? "Unreachable" : onchain.chainName : "Not deployed yet"}</dd></div>
      </dl>
    </section>

    {onchain && !onchain.deployed && <p className="df-banner">
      <strong>Oracle not deployed yet.</strong> Prices below are live off-chain. Deploy with <code>{onchain.deployCommand}</code>, set {onchain.envVars.join(", ")}, then run <code>{onchain.keeperCommand}</code>.
    </p>}

    <section className="df-card df-card-flush" aria-label="All feeds">
      {pending ? <SkeletonTable rows={10} cols={8} label="Loading feeds" />
        : error && !data ? <p className="df-error" role="alert">The feeds could not be loaded. {error}</p>
        : <div className="df-table-wrap">
          <table className="df-table df-feeds">
            <thead><tr>
              <th scope="col">Asset</th>
              <th scope="col" className="df-r">Price</th>
              <th scope="col" className="df-r">24h</th>
              <th scope="col" className="df-hide-md">Recent</th>
              <th scope="col" className="df-r df-hide-sm">Sources</th>
              <th scope="col" className="df-r df-hide-sm">Spread</th>
              <th scope="col" className="df-r df-hide-md">Updated</th>
              <th scope="col" className="df-hide-sm">Contract</th>
              <th scope="col" className="df-r">On-chain</th>
            </tr></thead>
            <tbody>{feeds.map((feed) => <tr key={feed.slug} className="df-feed-row">
              <th scope="row">
                <Link href={`/data-feeds/${feed.slug}`} className="df-asset">
                  <Mark name={feed.name} logo={null} size={32} />
                  <span className="df-asset-text"><strong>{feed.name}</strong><small className="df-num">{feed.symbol} / USD</small></span>
                </Link>
              </th>
              <td className="df-r df-num df-price">{feed.error ? <span className="df-faint" title={feed.error}>Unavailable</span> : money(feed.price)}</td>
              <td className={`df-r df-num ${feed.change24h === null ? "df-faint" : feed.change24h >= 0 ? "df-ok" : "df-bad"}`} title={feed.change24h === null ? `Needs 24 hours of samples (${feed.sampleCount} so far)` : undefined}>{signedPct(feed.change24h)}</td>
              <td className="df-hide-md">{feed.spark.length >= 3 ? <Spark values={feed.spark} width={96} height={26} label={`${feed.name} recent aggregates`} /> : <span className="df-faint df-small">Collecting</span>}</td>
              <td className="df-r df-num df-hide-sm">{feed.sourcesUsed}<span className="df-faint"> / {feed.sourcesTotal}</span></td>
              <td className="df-r df-num df-hide-sm">{bps(feed.dispersionBps)}</td>
              <td className="df-r df-num df-hide-md">{now && feed.computedAt ? ago(feed.computedAt, now) : "—"}</td>
              <td className="df-hide-sm">{chainPending ? <SkeletonInline width={120} /> : onchain?.deployed && onchainFor(onchain, feed.slug)?.feed
                ? <ContractChip address={onchainFor(onchain, feed.slug)!.feed!} explorer={onchain.explorer} label={`${feed.symbol} feed`} />
                : <span className="df-faint">—</span>}</td>
              <td className="df-r">{chainPending ? <SkeletonInline width={80} /> : <OnchainCell state={onchain} slug={feed.slug} configured={!!feed.oracle} now={now} live={feed.price} />}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
    <ContractsCard state={onchain ?? null} now={now} live={Object.fromEntries(feeds.map((feed) => [feed.slug, feed.price]))} />
    <p className="df-foot">Each price is the weighted mean of the sources within ±15% of their weighted median, weighted by trust in the kind of source and by its liquidity. Spread is the weighted standard deviation of those sources. The 24h change appears once a feed has a day of samples.</p>
  </>;

  if (variant === "pro") { return <main className="p-wrap p-main df df-pro">{body}</main>; }
  return <main className="pc-page df df-lite">{body}</main>;
}
