"use client";

import { ExternalLink } from "lucide-react";
import type { Onchain, OnchainAsset, OnchainRound, OracleAssetConfig } from "@/lib/data-feeds";
import { UPDATE_POLICY } from "@/lib/update-policy";
import { SkeletonLines } from "@/components/skeleton";
import { ago, bps, duration, money, shortAddress, signedPct } from "./shared";

/** What the oracle holds for one asset, or why it holds nothing. */

export function onchainFor(state: Onchain | null, slug: string): OnchainAsset | null {
  return state?.deployed ? state.assets.find((asset) => asset.slug === slug) ?? null : null;
}

const pushEvery = UPDATE_POLICY.pushEverySeconds;
const threshold = UPDATE_POLICY.deviationBps / 10_000;

/** The update rule in words, for headers and notes. */
export const UPDATE_RULE = `Updated every ${pushEvery / 3600} hours, or sooner when the live price moves ${(threshold * 100).toFixed(1)}% from the on-chain price. Checked every ${UPDATE_POLICY.checkEverySeconds / 60} minutes.`;

/** Time until an instant, as "in 3h 20m", or "now" once it has passed. */
export function until(ms: number, now: number): string {
  const left = Math.round((ms - now) / 60_000);
  if (left <= 0) { return "now"; }
  const hours = Math.floor(left / 60), minutes = left % 60;
  return `in ${hours ? `${hours}h ` : ""}${minutes}m`;
}

/**
 * Where a feed stands against the update rule: the gap between the live
 * aggregate and the on-chain round, when the next scheduled update falls, and
 * whether the keeper's next check will push it (and why).
 */
export function updateStatus(round: OnchainRound | null, live: number | null, now: number) {
  if (!round) { return { gap: null, nextAt: null, due: "No on-chain round yet" as string | null }; }
  const gap = live ? live / round.price - 1 : null;
  const nextAt = Date.parse(round.updatedAt) + pushEvery * 1000;
  const due = gap !== null && Math.abs(gap) >= threshold ? `Moved ${(Math.abs(gap) * 100).toFixed(2)}%, past ${(threshold * 100).toFixed(1)}%`
    : now >= nextAt ? "24 hours since the last update" : null;
  return { gap, nextAt, due };
}

/** The index table's on-chain cell: the price on the contract and its age, or the reason there is none. */
export function OnchainCell({ state, slug, configured, now, live = null }: { state: Onchain | null; slug: string; configured: boolean; now: number; live?: number | null }) {
  if (!state) { return <span className="df-faint">Unavailable</span>; }
  if (!state.deployed) { return <span className="df-chain df-chain-off">Not deployed</span>; }
  if (!configured) { return <span className="df-chain df-chain-off">Not on the oracle</span>; }
  const asset = onchainFor(state, slug);
  if (!asset?.round) { return <span className="df-chain df-chain-off">{asset?.error ? "Read failed" : "No round yet"}</span>; }
  const status = now ? updateStatus(asset.round, live, now) : null;
  return <span className={`df-chain ${asset.stale ? "df-chain-stale" : "df-chain-on"}`}>
    <span className="df-num">{money(asset.round.price)}</span>
    <small>{asset.stale ? "Stale, " : ""}{now ? ago(asset.round.updatedAt, now) : ""}</small>
    {status && <small className={status.due ? "df-due" : undefined} title={status.due ?? `Next scheduled update ${status.nextAt ? until(status.nextAt, now) : ""}`}>
      {status.gap === null ? "" : `${signedPct(status.gap)} live, `}{status.due ? "updating" : status.nextAt ? `next ${until(status.nextAt, now)}` : ""}
    </small>}
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
      <div className="df-kv"><dt>Update rule</dt><dd><span className="df-num">{pushEvery / 3600}h or {(threshold * 100).toFixed(1)}%</span><small>whichever comes first, checked every {UPDATE_POLICY.checkEverySeconds / 60} minutes</small></dd></div>
      {config && <>
        <div className="df-kv"><dt>Heartbeat</dt><dd><span className="df-num">{duration(config.heartbeat)}</span><small>stale after this; {fromChain ? "read from the contract" : "from scripts/assets.js"}</small></dd></div>
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
        <small>{diff === null ? "Nothing to compare yet" : wouldReject ? "Beyond the deviation guard: the next push would be rejected" : Math.abs(diff) >= threshold ? `Past ${(threshold * 100).toFixed(1)}%: pushed on the keeper's next check` : `Within ${(threshold * 100).toFixed(1)}%: no update needed yet`}</small>
      </div>
      <div className="df-round">
        <span className="df-round-label">Next scheduled update</span>
        {round && now ? <>
          <strong className="df-num">{until(Date.parse(round.updatedAt) + pushEvery * 1000, now)}</strong>
          <small>{pushEvery / 3600} hours after the last round, unless the price moves {(threshold * 100).toFixed(1)}% first</small>
        </> : <><strong className="df-faint">—</strong><small>after the first round</small></>}
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

/**
 * Every contract behind the feeds: the oracle, then one Chainlink-style
 * AggregatorV3 feed per asset, each linked to the explorer, with the update
 * rule they run on.
 */
export function ContractsCard({ state, now, live }: { state: Onchain | null; now: number; live: Record<string, number | null> }) {
  if (!state?.deployed) { return null; }
  const link = (address: string) => state.explorer
    ? <a className="df-addr" href={`${state.explorer.url}/address/${address}`} target="_blank" rel="noopener noreferrer" aria-label={`${address} on ${state.explorer.name}, opens in a new tab`}><span className="df-num">{shortAddress(address)}</span><ExternalLink size={12} aria-hidden /></a>
    : <span className="df-num df-addr" title={address}>{shortAddress(address)}</span>;
  return <section className="df-card df-card-flush" aria-labelledby="df-contracts-h">
    <header className="df-card-head df-pad">
      <div>
        <h2 id="df-contracts-h">Contracts</h2>
        <p className="df-lede">{UPDATE_RULE} A feed counts as stale once its price is older than the heartbeat.</p>
      </div>
      <span className={`df-pill ${state.error ? "df-pill-bad" : state.paused ? "df-pill-warn" : "df-pill-ok"}`}>{state.error ? "Unreachable" : state.paused ? "Paused" : state.chainName}</span>
    </header>
    <div className="df-table-wrap">
      <table className="df-table df-contracts">
        <thead><tr>
          <th scope="col">Contract</th>
          <th scope="col">Address</th>
          <th scope="col" className="df-r">On-chain price</th>
          <th scope="col" className="df-r df-hide-sm">Last update</th>
          <th scope="col" className="df-r df-hide-sm">vs live</th>
          <th scope="col" className="df-r">Next update</th>
          <th scope="col" className="df-r df-hide-md">Heartbeat</th>
        </tr></thead>
        <tbody>
          <tr className="df-contract-main">
            <th scope="row"><strong>PreIpoPriceOracle</strong><small>stores every feed&apos;s rounds</small></th>
            <td>{link(state.oracle)}</td>
            <td className="df-r df-faint" colSpan={5}>{state.assets.length} feeds</td>
          </tr>
          {state.assets.map((asset) => {
            const status = now ? updateStatus(asset.round, live[asset.slug] ?? null, now) : null;
            return <tr key={asset.symbol}>
              <th scope="row"><strong>{asset.config?.description ?? `${asset.symbol} / USD`}</strong><small>AggregatorV3 feed</small></th>
              <td>{asset.feed ? link(asset.feed) : <span className="df-faint">Not in the deployment file</span>}</td>
              <td className="df-r df-num">{asset.round ? money(asset.round.price) : <span className="df-faint">No round yet</span>}</td>
              <td className="df-r df-num df-hide-sm">{asset.round && now ? ago(asset.round.updatedAt, now) : "—"}</td>
              <td className={`df-r df-num df-hide-sm ${status?.due ? "df-due" : ""}`}>{status?.gap === null || !status ? "—" : signedPct(status.gap)}</td>
              <td className={`df-r df-num ${status?.due ? "df-due" : ""}`} title={status?.due ?? undefined}>{!status ? "—" : status.due ? "On the next check" : status.nextAt ? until(status.nextAt, now) : "—"}</td>
              <td className="df-r df-num df-hide-md">{asset.config ? duration(asset.config.heartbeat) : "—"}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </section>;
}
