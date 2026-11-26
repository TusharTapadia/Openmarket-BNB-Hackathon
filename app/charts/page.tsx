"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Layers } from "lucide-react";
import { MarketHeader } from "@/components/market-header";
import { IST, MarketTicker } from "@/components/market-ticker";
import { Change } from "@/components/change";
import { CompanyMark } from "@/components/company-mark";
import { DataState } from "@/components/data-state";
import { Sparkline } from "@/components/sparkline";
import { InfoTip } from "@/components/info-tip";
import { CompanyChart, type Metric } from "@/components/market-charts";
import { useRemoteData } from "@/hooks/use-market-data";
import { rebaseCompany, type CompanyPoint } from "@/lib/market-series";
import type { Derivatives } from "@/lib/market-summary";
import { formatMoney, formatPrice, formatSignedPercent, premium } from "../data";

type Tracked = {
  slug: string;
  name: string;
  logo: string | null;
  sector: string | null;
  price: number | null;
  markPrice: number | null;
  shares: number | null;
  valuation: number | null;
  round: string | null;
  roundDate: string | null;
  referenceVenues: number;
  referenceVolume: number | null;
  points: CompanyPoint[];
};

type ChartsData = {
  fetchedAt: string;
  companies: Tracked[];
  derivatives: Derivatives | null;
  windowDays: number;
};

const RANGES = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "All", days: Number.POSITIVE_INFINITY },
] as const;

const METRICS: { key: Metric; label: string }[] = [
  { key: "valuation", label: "Valuation" },
  { key: "volume", label: "Volume" },
  { key: "index", label: "Index" },
];

/** Change between the ends of a window, as a fraction. */
function changeOf(points: readonly CompanyPoint[], pick: (point: CompanyPoint) => number | null) {
  if (points.length < 2) { return null; }
  const first = pick(points[0]);
  const last = pick(points[points.length - 1]);
  return first !== null && last !== null && first > 0 ? last / first - 1 : null;
}

export default function Charts() {
  const { data, loading, error, refreshing, refresh } = useRemoteData<ChartsData>("/api/charts", true);
  const [metric, setMetric] = useState<Metric>("valuation");
  const [range, setRange] = useState<number>(30);
  const [picked, setPicked] = useState<string | null>(null);

  // Most traded first, the way a market page orders anything. Alphabetical
  // put Anduril -- one venue, $129 of daily volume -- ahead of Anthropic.
  const companies = useMemo(
    () => [...(data?.companies ?? [])].sort((a, b) => (b.referenceVolume ?? 0) - (a.referenceVolume ?? 0)),
    [data],
  );

  // Opens on the company with the most recorded history rather than the first
  // alphabetically: a card with nothing to plot is a poor first impression.
  // Derived during render rather than written into state by an effect, so the
  // first paint already has a selection.
  // Prefers a company that can actually show all three metrics: landing on
  // one the venues state no valuation for opens the page on a dash.
  const fallback = useMemo(() => {
    const usable = companies.filter((company) => company.points.length > 1 && company.valuation !== null);
    return (usable[0] ?? companies[0])?.slug ?? null;
  }, [companies]);
  const selected = companies.find((company) => company.slug === (picked ?? fallback)) ?? null;
  const points = useMemo(() => {
    const all = selected?.points ?? [];
    return rebaseCompany(Number.isFinite(range) ? all.slice(-range) : all);
  }, [selected, range]);

  const latest = points.length ? points[points.length - 1] : null;
  const change = changeOf(points, (point) =>
    metric === "valuation" ? point.valuation : metric === "volume" ? point.volume : point.index,
  );
  const derivatives = data?.derivatives ?? null;
  const refreshedAt = data ? IST.format(new Date(data.fetchedAt)) : null;
  const totalVolume = companies.reduce((sum, company) => sum + (company.referenceVolume ?? 0), 0);

  // "Now" figures come from the live reading, the same one the card above and
  // the company page show. Taking them off the end of the daily series instead
  // put $2.87T here against $2.85T there -- the last recorded close is not the
  // current price, and two numbers under one label is the whole problem.
  // The index has no live equivalent, so it stays a figure of the window.
  const headline =
    metric === "index" ? (latest === null ? "—" : latest.index.toFixed(2))
    : metric === "volume" ? formatMoney(selected?.referenceVolume ?? null)
    : formatMoney(selected?.valuation ?? null);

  return <div className="app-shell">
    <MarketHeader view="charts" />

    {/* No combined valuation here. These six are not a market -- they are the
        six we happen to track -- so a total of them answers nothing. Volume
        and venue counts add up honestly; valuation does not. */}
    <MarketTicker
      items={[
        { label: "Companies", value: loading ? "—" : String(companies.length) },
        { label: "Volume 24h", value: formatMoney(totalVolume || null) },
        { label: "Listings", value: loading ? "—" : String(derivatives?.venueCount ?? 0) },
      ]}
      loading={loading} error={error} refreshing={refreshing} refreshedAt={refreshedAt} onRefresh={refresh}
    />

    <main className="market-page">
      <section className="market-heading">
        <h1>Company charts</h1>
        <p className="page-description">
          Pick a company to see what it has been worth, what trades, and how its price has moved. Read from the venues
          every hour and recorded, so every line is drawn from readings rather than estimated between them.
        </p>
      </section>

      {loading ? <DataState loading title="Loading recorded history" description="Reading prices across venues." />
        : error && !data ? <DataState error title="Market feed unavailable" description={error} action={refresh} />
        : <>
          {/* The cards are the control. Clicking one changes the chart below
              rather than navigating away, which is what makes this a chart
              page and not a list of links. */}
          <section className="chart-strip" aria-label="Companies">
            {companies.map((company) => {
              const active = company.slug === selected?.slug;
              const prices = company.points.map((point) => point.price);
              return (
                <button
                  key={company.slug}
                  type="button"
                  aria-pressed={active}
                  className={`strip-card ${active ? "active" : ""}`}
                  onClick={() => setPicked(company.slug)}
                >
                  <span className="strip-head">
                    <CompanyMark name={company.name} logo={company.logo} />
                    <span className="strip-name">{company.name}</span>
                  </span>
                  <strong className="tabular">{formatPrice(company.price)}</strong>
                  <span className="strip-foot">
                    <Change value={changeOf(company.points.slice(-2), (point) => point.price)} />
                    <Sparkline values={prices.slice(-30)} width={96} height={28} />
                  </span>
                </button>
              );
            })}
          </section>

          <div className="charts-layout">
            <div className="charts-rail">
              <article className="feature-card">
                <div className="feature-head"><h2>{selected?.name ?? "Company"}</h2><span>now</span></div>
                <dl className="feature-rows">
                  <div><dt>Price</dt><dd>{formatPrice(selected?.price ?? null)}</dd></div>
                  <div>
                    <dt>Off-chain price<InfoTip label="off-chain price">The price of one share from private-market transactions (AllocationsX). The row below is how far the market price sits from it.</InfoTip></dt>
                    <dd>{formatPrice(selected?.markPrice ?? null)}</dd>
                  </div>
                  <div>
                    <dt>vs off-chain</dt>
                    <dd>{selected && premium(selected) !== null ? formatSignedPercent(premium(selected)) : "—"}</dd>
                  </div>
                  <div><dt>Sources in price</dt><dd>{selected?.referenceVenues ?? "—"}</dd></div>
                  <div><dt>Volume 24h</dt><dd>{formatMoney(selected?.referenceVolume ?? null)}</dd></div>
                </dl>
              </article>

              <article className="feature-card">
                <div className="feature-head">
                  <h2>Shares and valuation<InfoTip label="shares">Valuation is the weighted price per share times the company&apos;s share count on file (AllocationsX). The last priced round is shown beside it for comparison.</InfoTip></h2>
                  <span>basis</span>
                </div>
                <dl className="feature-rows">
                  <div>
                    <dt>Shares on file</dt>
                    <dd>{selected?.shares ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(selected.shares) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Valuation</dt>
                    <dd>{formatMoney(selected?.valuation ?? null)}</dd>
                  </div>
                  <div><dt>Last priced round</dt><dd>{selected?.round?.replace("Last priced round ", "") ?? "—"}</dd></div>
                </dl>
                {selected && selected.valuation === null && (
                  <p className="feature-empty">
                    There is no share count on file for {selected.name}, so no valuation is shown. Price and volume are unaffected.
                  </p>
                )}
                {selected && (
                  <Link className="rail-link" href={`/company/${selected.slug}`}>
                    Open {selected.name} <ArrowUpRight size={13} aria-hidden />
                  </Link>
                )}
              </article>

              <article className="feature-card">
                <div className="feature-head"><h2>Sector</h2><span>{selected?.sector ? 1 : 0}</span></div>
                <ul className="sector-rows">
                  <li>
                    <span className="sector-name"><Layers size={12} aria-hidden /> {selected?.sector ?? "Unclassified"}</span>
                    <span className="sector-figures">
                      <strong className="tabular">{companies.filter((company) => company.sector === selected?.sector).length}</strong>
                      <small>tracked</small>
                    </span>
                  </li>
                </ul>
              </article>
            </div>

            <article className="feature-card chart-main">
              <div className="chart-main-head">
                <div>
                  <div className="chart-tabs" role="tablist" aria-label="Metric">
                    {METRICS.map((item) => (
                      <button key={item.key} type="button" role="tab" aria-selected={metric === item.key}
                        className={metric === item.key ? "active" : ""} onClick={() => setMetric(item.key)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="chart-figure">
                    <strong className="tabular">{headline}</strong>
                    <Change value={change} />
                    <span className="chart-window">{selected?.name} · {points.length} day{points.length === 1 ? "" : "s"}</span>
                  </p>
                </div>
                <div className="range-tabs">
                  {RANGES.map((item) => (
                    <button key={item.label} type="button" className={range === item.days ? "active" : ""} onClick={() => setRange(item.days)}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {metric === "valuation" && selected && selected.valuation === null ? (
                <p className="chart-empty">
                  There is no share count on file for {selected.name}, so its valuation cannot be drawn. Volume and the index are still drawn.
                </p>
              ) : (
                <CompanyChart points={points} metric={metric} height={400} label={selected?.name ?? ""} />
              )}

              <p className="chart-note">
                <span><span className="chart-key" /> Daily close, from the last reading of each day</span>
                <span>{points.length} of {selected?.points.length ?? 0} recorded days</span>
              </p>
            </article>
          </div>
        </>}

      <footer className="page-footer">
        <div>
          <p>Price is the weighted price per share, the same figure the Data feeds page and the on-chain oracle carry. History is the daily median close of the markets that quote the company on the same unit, scaled so the latest day matches today&apos;s price; markets quoting another unit are left out. Valuation is price times the share count on file. Volume is summed across every market.</p>
          <p>Missing data is shown as &mdash;.</p>
        </div>
        <span className="footer-brand">Openmarkets</span>
      </footer>
    </main>
  </div>;
}
