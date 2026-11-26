"use client";

import { ExternalLink } from "lucide-react";
import type { Onchain, OnchainAsset, OracleAssetConfig } from "@/lib/data-feeds";
import { SkeletonLines } from "@/components/skeleton";
import { ago, bps, duration, money, shortAddress, signedPct } from "./shared";

/** What the oracle holds for one asset, or why it holds nothing. */

export function onchainFor(state: Onchain | null, slug: string): OnchainAsset | null {
  return state?.deployed ? state.assets.find((asset) => asset.slug === slug) ?? null : null;
}

/** The index table's on-chain cell: the price on the contract and its age, or the reason there is none. */
export function OnchainCell({ state, slug, configured, now }: { state: Onchain | null; slug: string; configured: boolean; now: number }) {
  if (!state) { return <span className="df-faint">Unavailable</span>; }
  if (!state.deployed) { return <span className="df-chain df-chain-off">Not deployed</span>; }
  if (!configured) { return <span className="df-chain df-chain-off">Not on the oracle</span>; }
  const asset = onchainFor(state, slug);
  if (!asset?.round) { return <span className="df-chain df-chain-off">{asset?.error ? "Read failed" : "No round yet"}</span>; }
  return <span className={`df-chain ${asset.stale ? "df-chain-stale" : "df-chain-on"}`}>
    <span className="df-num">{money(asset.round.price)}</span>
    <small>{asset.stale ? "Stale, " : ""}{now ? ago(asset.round.updatedAt, now) : ""}</small>
  </span>;
}

function Address({ label, address, explorer, kind }: { label: string; address: string; explorer: { name: string; url: string } | null; kind: "address" | "token" }) {
  return <div className="df-kv">
    <dt>{label}</dt>
    <dd>
      {explorer ? <a className="df-addr" href={`${explorer.url}/${kind}/${address}`} target="_blank" rel="noopener noreferrer" aria-label={`${label} ${address} on ${explorer.name}, opens in a new tab`}>
        <span className="df-num">{shortAddress(address)}</span><ExternalLink size={12} aria-hidden />
      </a> : <span className="df-num df-addr" title={address}>{shortAddress(address)}</span>}
    </dd>
  </div>;
}

/**
 * The detail page's on-chain section. `live` is the aggregate the site shows
 * now; the keeper would push exactly that, so the gap between it and the last
 * round is how far the contract trails the site.
 */
export function OnchainPanel({ state, loading, error, slug, oracle, live, now, headingId }: {
  state: Onchain | null;
  loading: boolean;
  error: string | null;
  slug: string;
  oracle: OracleAssetConfig | null;
  live: { price: number | null; sourcesUsed: number; dispersionBps: number | null; computedAt: string };
  now: number;
  headingId: string;
}) {
  const asset = onchainFor(state, slug);
  const config = asset?.config ?? (oracle ? { heartbeat: oracle.heartbeat, maxDeviationBps: oracle.maxDeviationBps, minSources: oracle.minSources, description: oracle.description, enabled: true } : null);
  const fromChain = !!asset?.config;
  const round = asset?.round ?? null;
  const diff = round && live.price ? live.price / round.price - 1 : null;
  const tooFew = config ? live.sourcesUsed < config.minSources : false;
  const wouldReject = diff !== null && config && config.maxDeviationBps > 0 && Math.abs(diff) * 10_000 > config.maxDeviationBps;

  return <section className="df-card" aria-labelledby={headingId}>
    <header className="df-card-head">
      <div>
        <h2 id={headingId}>On-chain</h2>
        <p className="df-lede">The aggregate is pushed to PreIpoPriceOracle by a keeper, with a Chainlink-style AggregatorV3 feed per asset.</p>
      </div>
      {state?.deployed && <span className={`df-pill ${state.error ? "df-pill-bad" : state.paused ? "df-pill-warn" : "df-pill-ok"}`}>
        {state.error ? "Unreachable" : state.paused ? "Paused" : state.chainName}
      </span>}
    </header>

    {loading && !state && <SkeletonLines lines={3} label="Reading the oracle" />}
    {error && !state && <p className="df-error" role="alert">The oracle could not be loaded. {error}</p>}

    {state && !state.deployed && <div className="df-undeployed">
      <p className="df-undeployed-title">Oracle not deployed yet</p>
      <p className="df-muted">{state.reason} Once it is live, this section reads the latest round straight from the contract. To put it there:</p>
      <ol className="df-steps">
        <li><span>Deploy the oracle and one feed per asset</span><code>{state.deployCommand}</code></li>
        <li><span>Point the site at it with</span><code>{state.envVars.map((name) => `${name}=…`).join("  ")}</code></li>
        <li><span>Run the keeper on a schedule, well inside the heartbeat</span><code>{state.keeperCommand}</code></li>
      </ol>
    </div>}

    {state?.deployed && state.error && <p className="df-error" role="alert">{state.error}</p>}

    <dl className="df-kvs">
      {state?.deployed && <Address label="Oracle contract" address={state.oracle} explorer={state.explorer} kind="address" />}
      {asset?.feed && state?.deployed && <Address label="Feed adapter" address={asset.feed} explorer={state.explorer} kind="address" />}
      {state?.deployed && !asset?.feed && <div className="df-kv"><dt>Feed adapter</dt><dd className="df-muted">Not in the deployment file</dd></div>}
      {oracle && <div className="df-kv"><dt>Asset key</dt><dd><span className="df-num df-addr" title={oracle.key}>{shortAddress(oracle.key)}</span><small>keccak256 of {oracle.symbol}</small></dd></div>}
      {config && <>
        <div className="df-kv"><dt>Heartbeat</dt><dd><span className="df-num">{duration(config.heartbeat)}</span><small>{fromChain ? "read from the contract" : "from scripts/assets.js"}</small></dd></div>
        <div className="df-kv"><dt>Deviation guard</dt><dd><span className="df-num">±{(config.maxDeviationBps / 100).toFixed(0)}%</span><small>largest move one update may make</small></dd></div>
        <div className="df-kv"><dt>Minimum sources</dt><dd><span className="df-num">{config.minSources}</span><small>{live.sourcesUsed} in the aggregate now</small></dd></div>
      </>}
    </dl>

    {!oracle && <p className="df-muted df-note">This asset is not configured on the oracle. Add it to contracts/scripts/assets.js and configure it on the contract to publish it.</p>}

    {oracle && state?.deployed && !state.error && <div className="df-rounds">
      <div className="df-round">
        <span className="df-round-label">Last on-chain round</span>
        {round ? <>
          <strong className="df-num">{money(round.price)}</strong>
          <small>Round {round.roundId}, {now ? ago(round.updatedAt, now) : ""}{asset?.stale ? ", past its heartbeat" : ""}</small>
          <small>{round.sourceCount} sources, spread {bps(round.dispersionBps)}</small>
        </> : <><strong className="df-faint">No round yet</strong><small>{asset?.error ?? "The keeper has not pushed this asset."}</small></>}
      </div>
      <div className="df-round">
        <span className="df-round-label">Live aggregate</span>
        <strong className="df-num">{money(live.price)}</strong>
        <small>{now ? ago(live.computedAt, now) : ""}, {live.sourcesUsed} sources</small>
      </div>
      <div className="df-round">
        <span className="df-round-label">Live against on-chain</span>
        <strong className={`df-num ${diff === null ? "df-faint" : ""}`}>{signedPct(diff)}</strong>
        <small>{diff === null ? "Nothing to compare yet" : wouldReject ? "Beyond the deviation guard: the next push would be rejected" : "Within the deviation guard"}</small>
      </div>
    </div>}

    {oracle && state && !state.deployed && live.price !== null && <div className="df-rounds">
      <div className="df-round">
        <span className="df-round-label">The keeper would push</span>
        <strong className="df-num">{Math.round(live.price * 1e8).toLocaleString("en-US")}</strong>
        <small>{money(live.price)} at 8 decimals</small>
      </div>
      <div className="df-round">
        <span className="df-round-label">With</span>
        <strong className="df-num">{live.sourcesUsed} sources</strong>
        <small>spread {bps(live.dispersionBps)}</small>
      </div>
      <div className="df-round">
        <span className="df-round-label">Accepted</span>
        <strong className={tooFew ? "df-bad" : "df-ok"}>{tooFew ? "No" : "Yes"}</strong>
        <small>{tooFew ? `${live.sourcesUsed} sources, the oracle wants ${config?.minSources}` : "Passes the source minimum"}</small>
      </div>
    </div>}
  </section>;
}
