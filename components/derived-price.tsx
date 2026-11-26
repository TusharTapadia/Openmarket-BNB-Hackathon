"use client";

import { useEffect, useState } from "react";
import "@/app/derived-price.css";
import type { DerivedPrice as DerivedPriceData, DerivedSource } from "@/lib/derived-price";

/**
 * The derived price for one share, with every source behind it: what it
 * quotes, how it was put on a one-share basis, and how much it counts.
 * Fetches /api/derived-price/{slug} and refreshes every minute.
 */

const REFRESH_MS = 60_000;

const money = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) { return "—"; }
  const digits = value >= 1 ? 2 : 4;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
const percent = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signed = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) { return "—"; }
  const text = Math.abs(value * 100).toFixed(1);
  return text === "0.0" ? "0.0%" : `${value > 0 ? "+" : "−"}${text}%`;
};

const KIND_NAMES: Record<DerivedSource["kind"], string> = {
  listing: "Listing", offchain: "Off-chain", atlas: "Atlas", perp: "Perp", spot: "Spot", cmc: "CoinMarketCap",
  xstocks: "xStocks", prestocks: "PreStocks", openstocks: "OpenStocks", paimon: "Paimon",
};
const BASIS_NAMES: Record<NonNullable<DerivedSource["basis"]>, string> = {
  share: "one share", rescaled: "rescaled", inferred: "inferred",
};

function SourceRow({ source }: { source: DerivedSource }) {
  const muted = source.status !== "included";
  return (
    <tr className={muted ? "dp-row dp-row-out" : "dp-row"}>
      <th scope="row" className="dp-source">
        <span className="dp-label">{source.label}</span>
        <span className="dp-provider">{KIND_NAMES[source.kind]} · {source.provider}</span>
        <span className="dp-note">{source.note}</span>
      </th>
      <td className="dp-num">
        <span className="dp-figure">{money(source.price)}</span>
        {source.price !== source.rawPrice && <span className="dp-sub">raw {money(source.rawPrice)} · {source.rawUnit}</span>}
        {source.basis && <span className="dp-sub">{BASIS_NAMES[source.basis]}</span>}
      </td>
      <td className="dp-num dp-hide-sm">
        <span className="dp-figure">{source.trust.toFixed(2)}</span>
        <span className="dp-sub">trust</span>
      </td>
      <td className="dp-num dp-hide-sm">
        <span className="dp-figure">{source.popularity.toFixed(2)}</span>
        <span className="dp-sub" title={source.liquidityNote}>popularity</span>
      </td>
      <td className="dp-weight">
        {source.status === "included" ? (
          <>
            <span className="dp-figure">{percent(source.weightShare)}</span>
            <span className="dp-bar" aria-hidden="true"><span style={{ width: `${Math.max(source.weightShare * 100, 1)}%` }} /></span>
          </>
        ) : (
          <span className={`dp-status dp-status-${source.status}`}>{source.status === "outlier" ? "Outlier" : "Excluded"}</span>
        )}
      </td>
      <td className={`dp-num ${source.deviation === null ? "" : source.deviation >= 0 ? "dp-up" : "dp-down"}`}>
        <span className="dp-figure">{signed(source.deviation)}</span>
      </td>
    </tr>
  );
}

export function DerivedPrice({ slug, companyName }: { slug: string; companyName: string }) {
  const [data, setData] = useState<DerivedPriceData | null>(null);
  const [error, setError] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Bumped by "Try again" to refetch at once rather than wait for the next tick.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => fetch(`/api/derived-price/${encodeURIComponent(slug)}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) { throw new Error(String(response.status)); }
        return response.json() as Promise<DerivedPriceData>;
      })
      .then((body) => { setData(body); setError(false); })
      .catch((reason: Error) => { if (reason.name !== "AbortError") { setError(true); } });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [slug, attempt]);

  const included = data?.sources.filter((source) => source.status === "included") ?? [];
  const others = data?.sources.filter((source) => source.status !== "included") ?? [];
  const rows = showAll ? [...included, ...others] : included;

  return (
    <section className="dp" aria-labelledby={`dp-title-${slug}`}>
      <header className="dp-head">
        <div>
          <h2 id={`dp-title-${slug}`} className="dp-title">Derived price</h2>
          <p className="dp-lede">One {companyName} share, from every source we read, weighted by trust and liquidity.</p>
        </div>
        <div className="dp-price" aria-live="polite">
          {data ? (
            <>
              <span className="dp-price-figure">{money(data.price)}</span>
              <span className="dp-price-meta">
                {data.sourcesUsed} of {data.sources.length} sources
                {data.dispersionBps !== null && <> · spread ±{(data.dispersionBps / 100).toFixed(1)}%</>}
              </span>
            </>
          ) : error ? (
            <span className="dp-price-meta">Unavailable right now.</span>
          ) : (
            <span className="dp-price-figure dp-pending" aria-label="Loading">$—</span>
          )}
        </div>
      </header>

      {error && !data && (
        <p className="dp-error" role="alert">
          The derived price could not be loaded. <button type="button" className="dp-link" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
        </p>
      )}

      {data && (
        <>
          <details className="dp-method">
            <summary>How it is worked out</summary>
            <ul>
              <li>Every price is put on a one-share basis first. Perps that quote a valuation in billions are divided by the share count; tokens worth several shares are divided by that number. A source whose unit cannot be placed is left out, never averaged in.</li>
              <li>Each source is weighted by trust × popularity. Trust is set per kind of source (listing {data.method.trust.classes.listing}, off-chain {data.method.trust.classes.offchain}, Atlas {data.method.trust.classes.atlas}, perps {data.method.trust.classes.perp}, CoinMarketCap {data.method.trust.classes.cmc}, issuer tokens {data.method.trust.classes.openstocks}–{data.method.trust.classes.xstocks}), lowered when the unit is rescaled or inferred.</li>
              <li>Popularity scores daily liquidity on a log scale: $1K a day is 0, $1M is 0.5, $1B is 1. Volume, open interest, token market cap and holders count where a source reports them.</li>
              <li>Anything more than ±{percent(data.method.outlierBand, 0)} from the weighted median is an outlier and gets no weight. The price is the weighted mean of the rest.</li>
            </ul>
          </details>

          {data.price === null ? (
            <p className="dp-empty">No source for {companyName} could be placed on a one-share basis yet.</p>
          ) : (
            <div className="dp-table-wrap">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col" className="dp-num">Per share</th>
                    <th scope="col" className="dp-num dp-hide-sm">Trust</th>
                    <th scope="col" className="dp-num dp-hide-sm">Popularity</th>
                    <th scope="col">Weight</th>
                    <th scope="col" className="dp-num">vs derived</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((source) => <SourceRow key={source.id} source={source} />)}
                </tbody>
              </table>
            </div>
          )}

          {others.length > 0 && (
            <button type="button" className="dp-link dp-toggle" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Hide" : "Show"} {others.length} left out
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default DerivedPrice;
