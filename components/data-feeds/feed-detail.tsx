"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import "@/app/data-feeds.css";
import type { FeedDetail as FeedDetailData, Interval, Onchain } from "@/lib/data-feeds";
import { Mark } from "@/components/pc";
import { SkeletonInline, SkeletonLines, SkeletonTable } from "@/components/skeleton";
import { OnchainPanel, onchainFor } from "./onchain";
import { ContractChip } from "./contract-chip";
import { PriceDynamics } from "./price-dynamics";
import { SourcesTable } from "./sources-table";
import { ago, bps, money, signedPct, useNow, usePoll } from "./shared";

/**
 * One asset's data feed: the aggregate, how it is formed, its history, every
 * source behind it, and what the oracle holds. Polls every 10 seconds while
 * open, which also keeps the server's sampler recording.
 */

const POLL_MS = 10_000;

export function FeedDetail({ slug, variant }: { slug: string; variant: "lite" | "pro" }) {
  const [interval, setRange] = useState<Interval>("1m");
  const { data, error, loading } = usePoll<FeedDetailData>(`/api/data-feeds/${encodeURIComponent(slug)}?interval=${interval}`, POLL_MS);
  const chain = usePoll<Onchain>(`/api/data-feeds/onchain?slug=${encodeURIComponent(slug)}`, 30_000);
  const now = useNow(1000);
  const outliers = data?.sources.filter((source) => source.status === "outlier").length ?? 0;
  const excluded = data?.sources.filter((source) => source.status === "excluded").length ?? 0;
  const history = data?.history.interval === interval ? data.history : null;
  const historyPending = !history && (loading || !error);

  const body = <>
    <Link href="/data-feeds" className="df-back"><ArrowLeft size={14} aria-hidden />All data feeds</Link>

    {error && !data ? <section className="df-card"><p className="df-error" role="alert">This feed could not be loaded. {error}</p></section> : <>
      <section className="df-head" aria-labelledby="df-asset">
        <div className="df-head-id">
          {data ? <Mark name={data.asset.name} logo={null} size={48} /> : <SkeletonInline width={48} height={48} radius={9999} />}
          <div>
            <h1 id="df-asset">{data ? `${data.asset.name} / USD` : <SkeletonInline width={185} height={23} />}</h1>
            <p className="df-muted">{data ? <>Feed <span className="df-num">{data.asset.symbol}</span>, price of one share in US dollars</> : <SkeletonInline width={155} />}</p>
          </div>
        </div>
        <div className="df-head-price" aria-live="polite">
          <span className="df-big df-num">{data ? money(data.price) : <SkeletonInline width={104} height={32} />}</span>
          <span className="df-head-meta">
            {data ? <>
              <span className={data.change24h === null ? "df-faint" : data.change24h >= 0 ? "df-ok" : "df-bad"} title={data.change24h === null ? "Needs 24 hours of samples" : undefined}>{data.change24h === null ? "24h change after a day of samples" : `${signedPct(data.change24h)} in 24h`}</span>
              <span>{now ? `Updated ${ago(data.computedAt, now)}` : "Updated"}</span>
            </> : <SkeletonInline width={124} />}
          </span>
        </div>
      </section>

      <dl className="df-method">
        <div><dt>Aggregation</dt><dd>{data ? `Weighted mean of sources within ±${Math.round(data.method.outlierBand * 100)}% of the weighted median` : <SkeletonInline width="100%" />}</dd></div>
        <div><dt>Weights</dt><dd>{data ? `Base trust × log-scaled liquidity. Atlas Oracle ${data.method.trust.classes.atlas}, CoinMarketCap ${data.method.trust.classes.cmc}.` : <SkeletonInline width="100%" />}</dd></div>
        <div><dt>Sources</dt><dd>{data ? <><span className="df-num">{data.sourcesUsed}</span> active{outliers ? `, ${outliers} outlier${outliers === 1 ? "" : "s"}` : ""}{excluded ? `, ${excluded} excluded` : ""}, spread <span className="df-num">{bps(data.dispersionBps)}</span></> : <SkeletonInline width="75%" />}</dd></div>
        <div><dt>Contracts on BNB Chain</dt><dd className="df-chips">{chain.data?.deployed ? <>
          {onchainFor(chain.data, slug)?.feed && <span className="df-chip-row"><small>Feed</small><ContractChip address={onchainFor(chain.data, slug)!.feed!} explorer={chain.data.explorer} label={`${data?.asset.symbol ?? slug} feed`} /></span>}
          <span className="df-chip-row"><small>Oracle</small><ContractChip address={chain.data.oracle} explorer={chain.data.explorer} label="Oracle" /></span>
        </> : chain.data ? <span className="df-faint">Not deployed yet</span> : <SkeletonInline width="80%" />}</dd></div>
      </dl>

      <PriceDynamics history={history} interval={interval} onInterval={setRange} loading={historyPending} error={!history && !historyPending ? error : null} headingId="df-dyn" />

      {data ? <SourcesTable sources={data.sources} now={now} headingId="df-sources" /> : <section className="df-card" aria-labelledby="df-sources"><header className="df-card-head"><h2 id="df-sources">Verified data sources</h2></header><SkeletonTable rows={5} cols={7} label="Loading sources" /></section>}

      {data ? <OnchainPanel state={chain.data} loading={chain.loading} error={chain.error} slug={slug} oracle={data.oracle} now={now} headingId="df-chain"
        live={{ price: data.price, sourcesUsed: data.sourcesUsed, dispersionBps: data.dispersionBps, computedAt: data.computedAt }} />
        : <section className="df-card" aria-labelledby="df-chain"><header className="df-card-head"><h2 id="df-chain">On-chain</h2></header><SkeletonLines lines={3} label="Reading the oracle" /></section>}
    </>}
  </>;

  if (variant === "pro") { return <main className="p-wrap p-main df df-pro df-detail">{body}</main>; }
  return <main className="pc-page df df-lite df-detail">{body}</main>;
}
