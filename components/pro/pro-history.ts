"use client";

import { useRemoteData } from "@/hooks/use-market-data";
import type { HistoryPayload, MarketHistory } from "@/app/api/coverage/history/route";
import type { AssetType, CompanyView, MarketRow } from "@/lib/coverage-view";

/**
 * Daily history across every covered market (from /api/coverage/history) and
 * the series the Pro charts draw from it. Nothing here fills a gap: a day a
 * market has no candle is a day it is left out of, never an interpolated one.
 */

export type { HistoryPayload, MarketHistory };

export function useHistory(enabled = true) {
  return useRemoteData<HistoryPayload>(enabled ? "/api/coverage/history" : null);
}

export const marketKey = (market: { venue: string; marketType: string; market: string }) => `${market.venue}|${market.marketType}|${market.market}`;

export function historyIndex(history: HistoryPayload | null) {
  return new Map((history?.markets ?? []).map((market) => [marketKey(market), market]));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A company's daily median close across its main-basis markets of `type`, and
 * its daily USD volume summed across all its markets of `type`.
 */
export function companyDaily(company: CompanyView, index: Map<string, MarketHistory>, type: AssetType | "all") {
  const ofType = (row: MarketRow) => type === "all" || row.marketType === type;
  const closes = new Map<string, number[]>();
  for (const row of company.main.filter(ofType)) {
    for (const point of index.get(marketKey(row))?.points ?? []) {
      closes.set(point.at, [...(closes.get(point.at) ?? []), point.close]);
    }
  }
  const volumes = new Map<string, number>();
  for (const row of company.rows.filter(ofType)) {
    for (const point of index.get(marketKey(row))?.points ?? []) {
      if (point.volumeUsd === null || point.volumeUsd === undefined) { continue; }
      volumes.set(point.at, (volumes.get(point.at) ?? 0) + point.volumeUsd);
    }
  }
  return {
    close: new Map([...closes.entries()].map(([at, values]) => [at, median(values)])),
    volume: volumes,
  };
}

export type StackMetric = "value" | "volume";
export type StackRow = { at: string } & Record<string, number | string>;

/**
 * One row per day with a value per company, for a stacked chart. Only days on
 * which every company in the chart has a value are kept, so the stack's total
 * never dips because a company is missing rather than smaller.
 *
 * "value" is the off-chain valuation carried back through the markets' own
 * moves: today's point is the off-chain valuation, and each earlier day is it
 * times (that day's median close ÷ the latest median close). Only ratios of
 * one series are used, so it holds whether a venue quotes a share or a
 * valuation ÷ notional shares. "volume" drops today's candle, still in progress.
 */
export function stackedSeries(companies: CompanyView[], index: Map<string, MarketHistory>, metric: StackMetric, type: AssetType | "all") {
  const included: { company: CompanyView; values: Map<string, number> }[] = [];
  const excluded: CompanyView[] = [];
  for (const company of companies) {
    const daily = companyDaily(company, index, type);
    if (metric === "value") {
      if (!company.offchainValuation) { if (daily.close.size) { excluded.push(company); } continue; }
      const latest = daily.close.get([...daily.close.keys()].sort().pop()!);
      if (!latest) { continue; }
      const scale = company.offchainValuation / latest;
      const values = new Map([...daily.close.entries()].map(([at, close]) => [at, close * scale]));
      if (values.size) { included.push({ company, values }); }
    } else {
      const values = new Map([...daily.volume.entries()].filter(([at]) => at !== today()));
      if (values.size) { included.push({ company, values }); }
    }
  }
  const dates = [...new Set(included.flatMap((item) => [...item.values.keys()]))].sort()
    .filter((at) => included.every((item) => item.values.has(at)));
  const rows: StackRow[] = dates.map((at) => {
    const row: StackRow = { at };
    for (const item of included) { row[item.company.slug] = item.values.get(at)!; }
    return row;
  });
  return { rows, companies: included.map((item) => item.company), excluded };
}

/**
 * Valuation-weighted index of median closes, 100 at the first day of the
 * window on which every weighted company has a close. Weights are each
 * company's share of total off-chain valuation, held fixed.
 */
export function valuationIndex(companies: CompanyView[], index: Map<string, MarketHistory>, days: number) {
  const weighted = companies.filter((company) => (company.offchainValuation ?? 0) > 0)
    .map((company) => ({ company, close: companyDaily(company, index, "all").close }))
    .filter((item) => item.close.size >= 2);
  const total = weighted.reduce((sum, item) => sum + item.company.offchainValuation!, 0);
  const dates = [...new Set(weighted.flatMap((item) => [...item.close.keys()]))].sort()
    .filter((at) => weighted.every((item) => item.close.has(at))).slice(-(days + 1));
  if (dates.length < 2 || total <= 0) { return { rows: [] as StackRow[], companies: weighted.map((item) => item.company) }; }
  const base = dates[0];
  const rows: StackRow[] = dates.map((at) => {
    const row: StackRow = { at, index: 0 };
    let level = 0;
    for (const item of weighted) {
      const rebased = item.close.get(at)! / item.close.get(base)! * 100;
      row[item.company.slug] = rebased;
      level += item.company.offchainValuation! / total * rebased;
    }
    row.index = level;
    return row;
  });
  return { rows, companies: weighted.map((item) => item.company) };
}

/**
 * Rolling realized volatility of each company's median close: the standard
 * deviation of `window` daily log returns, annualized over 365 days because
 * these venues trade every day. A return is taken only between consecutive
 * calendar days, so a missing candle breaks the window rather than stretching it.
 */
export function rollingVolatility(companies: CompanyView[], index: Map<string, MarketHistory>, window: number) {
  const perCompany = companies.map((company) => {
    const close = companyDaily(company, index, "all").close;
    const dates = [...close.keys()].sort();
    const returns: { at: string; value: number }[] = [];
    for (let position = 1; position < dates.length; position += 1) {
      const gap = (Date.parse(dates[position]) - Date.parse(dates[position - 1])) / 86_400_000;
      if (gap !== 1) { continue; }
      returns.push({ at: dates[position], value: Math.log(close.get(dates[position])! / close.get(dates[position - 1])!) });
    }
    const vol = new Map<string, number>();
    for (let end = window; end <= returns.length; end += 1) {
      const slice = returns.slice(end - window, end);
      const span = (Date.parse(slice[slice.length - 1].at) - Date.parse(slice[0].at)) / 86_400_000;
      if (span !== window - 1) { continue; }
      const mean = slice.reduce((sum, item) => sum + item.value, 0) / window;
      const variance = slice.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) / (window - 1);
      vol.set(slice[slice.length - 1].at, Math.sqrt(variance) * Math.sqrt(365));
    }
    return { company, vol };
  }).filter((item) => item.vol.size > 0);
  const dates = [...new Set(perCompany.flatMap((item) => [...item.vol.keys()]))].sort();
  const rows: StackRow[] = dates.map((at) => {
    const row: StackRow = { at };
    for (const item of perCompany) { const value = item.vol.get(at); if (value !== undefined) { row[item.company.slug] = value; } }
    return row;
  });
  return { rows, companies: perCompany.map((item) => item.company) };
}

/** Change over the last `days` daily candles of one market, between consecutive calendar days only. */
export function marketChange(points: { at: string; close: number }[] | undefined, days: number): number | null {
  if (!points || points.length < 2) { return null; }
  const last = points[points.length - 1];
  const target = new Date(Date.parse(`${last.at}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const earlier = points.find((point) => point.at === target);
  return earlier && earlier.close > 0 ? last.close / earlier.close - 1 : null;
}

/** First daily candle within the history window, if it falls inside the last `days`. */
export function listedWithin(points: { at: string }[] | undefined, days: number, windowDays = 90): string | null {
  if (!points?.length) { return null; }
  const first = points[0].at;
  const age = (Date.now() - Date.parse(`${first}T00:00:00Z`)) / 86_400_000;
  // A series that starts at the window's edge may simply be older than the window.
  return age <= days && age < windowDays - 2 ? first : null;
}
