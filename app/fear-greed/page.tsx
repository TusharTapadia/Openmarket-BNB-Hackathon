"use client";

import { useMemo } from "react";
import { MarketHeader } from "@/components/market-header";
import { IST, MarketTicker } from "@/components/market-ticker";
import { DataState } from "@/components/data-state";
import { InfoTip } from "@/components/info-tip";
import { BandPill, FearGreedChart, FearGreedGauge } from "@/components/fear-greed";
import { useRemoteData } from "@/hooks/use-market-data";
import { run, spread, typical, type FearGreed } from "@/lib/fear-greed";
import { formatDate, formatMoney } from "../data";

type Feed = {
  fetchedAt: string;
  reading: FearGreed | null;
  context: {
    longPaying: number;
    shortPaying: number;
    openInterest: number;
    volume: number;
    venueCount: number;
  };
  coverage?: {
    counted: number;
    covered: number;
    omitted: string[];
    topTwoShare: number;
    startedAt: string | null;
  };
};

/** A count of days with its share of the record beside it. */
const days = (count: number, of: number) =>
  `${count} ${count === 1 ? "day" : "days"} · ${of ? Math.round((count / of) * 100) : 0}%`;

/** The reading `days` ago, or null when the series does not reach back that far. */
function ago(reading: FearGreed | null, days: number): number | null {
  if (!reading?.history.length) { return null; }
  // Counted back from the last recorded day rather than from the clock. The
  // feed can be a day behind, and measuring against now made "Yesterday" name
  // the same day as the gauge above it -- or skip one, depending on the hour
  // the page was opened, since the recorded dates are midnight UTC.
  const latest = Date.parse(reading.history[reading.history.length - 1].at);
  const target = latest - days * 86_400_000;
  // The nearest recorded day at or before the target: the series is daily and
  // a gap would otherwise read as "no value" rather than "the day before".
  const candidates = reading.history.filter((point) => Date.parse(point.at) <= target);
  return candidates.length ? candidates[candidates.length - 1].score : null;
}

export default function FearGreedPage() {
  const { data, loading, error, refreshing, refresh } = useRemoteData<Feed>("/api/fear-greed", true);
  const reading = data?.reading ?? null;
  const refreshedAt = data ? IST.format(new Date(data.fetchedAt)) : null;

  const extremes = useMemo(() => {
    const history = reading?.history ?? [];
    if (!history.length) { return null; }
    return history.reduce(
      (acc, point) => ({
        high: point.score >= acc.high.score ? point : acc.high,
        low: point.score <= acc.low.score ? point : acc.low,
      }),
      { high: history[0], low: history[0] },
    );
  }, [reading]);

  const held = useMemo(() => run(reading?.history ?? []), [reading]);
  const middle = useMemo(() => typical(reading?.history ?? []), [reading]);
  const sat = useMemo(() => spread(reading?.history ?? []), [reading]);

  return <div className="app-shell">
    <MarketHeader view="fear-greed" />

    <MarketTicker
      items={[
        { label: "Reading", value: reading ? String(reading.score) : "—" },
        { label: "Recorded days", value: reading ? String(reading.recordedDays) : "—" },
        { label: "Open interest", value: formatMoney(data?.context.openInterest || null) },
        { label: "Listings", value: data ? String(data.context.venueCount) : "—" },
      ]}
      loading={loading} error={error} refreshing={refreshing} refreshedAt={refreshedAt} onRefresh={refresh}
    />

    <main className="market-page">
      <section className="market-heading">
        <h1>Fear and greed</h1>
        <p className="page-description">
          One reading for how this market is behaving, from 0 to 100. Built from what we record
          — where prices sit against their own average, how hard they are moving, how many
          companies are rising, and how much is trading — each measured the same way today as on
          every day behind it.
        </p>
      </section>

      {loading && !data ? <DataState loading title="Loading recorded history" description="Reading prices across venues." />
        : error && !data ? <DataState error title="Fear and greed unavailable" description={error} action={refresh} />
        : !reading ? <DataState title="Not enough recorded history" description="The reading needs thirty days of recorded prices behind it before it can be stated." />
        : <>
          <div className="fg-layout">
            <div className="fg-rail">
              <section className="fg-card">
                <h2>Reading now<InfoTip label="reading">Zero is maximum fear, one hundred is maximum greed. It is the plain average of the four measurements below, each mapped onto the same scale. Not comparable with a crypto fear and greed index: the inputs are different because this market is.</InfoTip></h2>
                <FearGreedGauge score={reading.score} />
              </section>

              <section className="fg-card">
                <h2>What it is made of<InfoTip label="components">Each measurement is taken from the recorded daily series and mapped onto 0–100, then averaged with equal weight. Nothing here is weighted ahead of the rest, because nothing about this market justifies claiming one signal leads the others.</InfoTip></h2>
                <dl className="fg-components">
                  {reading.components.map((component) => (
                    <div key={component.key}>
                      <dt>{component.label}</dt>
                      <dd><BandPill score={Math.round(component.score)} /></dd>
                      <p>{component.reading}</p>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            <div className="fg-main">
              <section className="fg-card">
                <div className="fg-chart-head">
                  <h2>Reading over time</h2>
                  <p>{reading.history.length} days plotted · {formatDate(reading.history[0].at)} – {formatDate(reading.history[reading.history.length - 1].at)}</p>
                </div>
                <FearGreedChart points={reading.history} />
                {/* Said on the page rather than buried in a tooltip: the first
                    thirty recorded days have no reading because the trailing
                    measurements had nothing to compare against yet. */}
                <p className="fg-note">
                  The first {reading.warmupDays} of {reading.recordedDays} recorded days are not plotted: the
                  momentum, volatility and volume measurements each compare a day against the days behind
                  it, and those had nothing behind them yet.
                </p>
              </section>

              {/* Three short cards across the foot of the column rather than
                  stacked in the rail. The rail ran two cards longer than the
                  chart beside it, which left the page ending in a column of
                  white as deep as the cards that caused it. */}
              <div className="fg-foot">
                {data && (
                  <section className="fg-card">
                    <h2>Positioning<InfoTip label="positioning">Reported beside the reading, deliberately not inside it. Funding and open interest are the clearest sentiment signals the venues publish, but only their current value is stored, not their history — folding them in would make this gauge measure something the line above it cannot.</InfoTip></h2>
                    <dl className="fg-context">
                      <div><dt>Venues where longs pay</dt><dd className="tabular">{data.context.longPaying}</dd></div>
                      <div><dt>Venues where shorts pay</dt><dd className="tabular">{data.context.shortPaying}</dd></div>
                      <div><dt>Open interest</dt><dd className="tabular">{formatMoney(data.context.openInterest || null)}</dd></div>
                      <div><dt>Volume (24h)</dt><dd className="tabular">{formatMoney(data.context.volume || null)}</dd></div>
                    </dl>
                  </section>
                )}
                <section className="fg-card">
                  <h2>Recorded values</h2>
                  <dl className="fg-history">
                    {([["Yesterday", 1], ["Last week", 7], ["Last month", 30]] as const).map(([label, days]) => (
                      <div key={label}><dt>{label}</dt><dd><BandPill score={ago(reading, days)} /></dd></div>
                    ))}
                  </dl>
                </section>

                {extremes && (
                  <section className="fg-card">
                    <h2>High and low<InfoTip label="extremes">Across the recorded period only — the days plotted above, about three months. Not a yearly figure, because the feed does not hold a year.</InfoTip></h2>
                    <dl className="fg-history">
                      <div><dt>Highest ({formatDate(extremes.high.at)})</dt><dd><BandPill score={extremes.high.score} /></dd></div>
                      <div><dt>Lowest ({formatDate(extremes.low.at)})</dt><dd><BandPill score={extremes.low.score} /></dd></div>
                    </dl>
                  </section>
                )}
              </div>

            </div>
          </div>
              {/* A full-width row under both columns, four across: what the record looks like taken as
              a whole, rather than the three readings above it, which all
              answer "what is it now". */}
          <div className="fg-foot fg-foot-wide">
            <section className="fg-card">
              <h2>Where the days sat<InfoTip label="spread">The plotted days counted three ways: sixty and above is greed, forty to sixty is neutral, below forty is fear. Three buckets rather than the five bands because this market has not once touched extreme fear in the days on file, and two rows of zero say nothing.</InfoTip></h2>
              <dl className="fg-history">
                <div><dt>Greed or above</dt><dd className="tabular">{days(sat.greed, reading.history.length)}</dd></div>
                <div><dt>Neutral</dt><dd className="tabular">{days(sat.neutral, reading.history.length)}</dd></div>
                <div><dt>Fear or below</dt><dd className="tabular">{days(sat.fear, reading.history.length)}</dd></div>
              </dl>
            </section>

            {held && (
              <section className="fg-card">
                <h2>How long it has held</h2>
                <dl className="fg-history">
                  <div><dt>In {held.band.toLowerCase()} for</dt><dd className="tabular">{held.days} {held.days === 1 ? "day" : "days"}</dd></div>
                  <div><dt>Since</dt><dd className="tabular">{formatDate(held.since)}</dd></div>
                  <div><dt>Longest run on file</dt><dd className="tabular">{held.longest.days} days · {held.longest.band.toLowerCase()}</dd></div>
                </dl>
              </section>
            )}

            {middle && (
              <section className="fg-card">
                <h2>Typical reading<InfoTip label="typical">Both the average and the middle value, because the scale clamps at either end: a day trading at three times its usual volume scores the same hundred as one trading at twice, so the average carries a little of that flattening and the median does not.</InfoTip></h2>
                <dl className="fg-history">
                  <div><dt>Average</dt><dd><BandPill score={middle.average} /></dd></div>
                  <div><dt>Middle value</dt><dd><BandPill score={middle.median} /></dd></div>
                  <div><dt>Today stands above</dt><dd className="tabular">{middle.percentile}% of days</dd></div>
                </dl>
              </section>
            )}

            {data?.coverage && (
              <section className="fg-card">
                <h2>What it is drawn from<InfoTip label="coverage">The reading is built from the companies that have both a stated valuation and a recorded price behind them{data.coverage.omitted.length ? `. Left out: ${data.coverage.omitted.join(", ")} -- covered by the market page, but with nothing recorded to carry a valuation back through` : ""}. The record starts where the last of them first had a price, not where the feed does.</InfoTip></h2>
                <dl className="fg-history">
                  <div><dt>Companies counted</dt><dd className="tabular">{data.coverage.counted} of {data.coverage.covered}</dd></div>
                  <div><dt>Largest two carry</dt><dd className="tabular">{Math.round(data.coverage.topTwoShare * 100)}%</dd></div>
                  <div><dt>Recorded from</dt><dd className="tabular">{data.coverage.startedAt ? formatDate(data.coverage.startedAt) : "—"}</dd></div>
                </dl>
              </section>
            )}
          </div>
        </>}
    </main>
  </div>;
}
