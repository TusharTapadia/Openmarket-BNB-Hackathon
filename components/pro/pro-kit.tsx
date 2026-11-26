"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { changeOver, formatSignedPercent } from "@/app/data";
import { useRemoteData } from "@/hooks/use-market-data";
import { companyView, fundingText, TYPE_INFO, VENUE_NAMES, type AssetType, type CompanyView, type CoveragePayload, type IssuerToken, type MarketRow } from "@/lib/coverage-view";
import type { CompanyMarketData } from "@/lib/company-data";
import { InfoTip } from "@/components/info-tip";
import { ExternalLink } from "lucide-react";
import { ExchangeMark, logoKey } from "@/components/exchange-mark";

/**
 * Shared pieces of the Pro (institutional) version: the chrome every Pro page
 * sits in, the data hook they all read, and small cells. Everything renders
 * inside `.pro`, and every class is styled from app/pro.css under that scope.
 */

export const IST_TIME = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** What an issuer's token adds to a market row: where it lives and the issuer's own figures. */
export type IssuerInfo = { chain: string; markPrice: number | null; change30d: number | null };

/**
 * A market and the company it trades. Issuer tokens (OpenStocks, PreStocks,
 * xStocks) are listed as spot markets too, with the issuer as both provider and
 * venue; `issuer` marks them, since they have no venue volume or daily candles.
 */
export type FlatMarket = MarketRow & { company: CompanyView; issuer?: IssuerInfo };

/** An issuer's token as a spot market row. It never feeds a median: those come from the company's own rows. */
export function issuerMarket(company: CompanyView, token: IssuerToken): FlatMarket {
  return {
    companySlug: company.slug,
    venue: token.issuer as MarketRow["venue"],
    marketType: "spot",
    market: token.symbol,
    label: token.symbol,
    provider: token.issuer,
    dex: null,
    quoteAsset: "USD",
    price: token.price,
    volume24hUsd: null,
    volume30dUsd: null,
    openInterestUsd: null,
    fundingRateAnnualized: null,
    feeRateBps: 0,
    tradeUrl: token.url ?? "",
    capturedAt: "",
    estFees30dUsd: null,
    offBasis: false,
    basis: null,
    impliedValuation: token.impliedValuation,
    company,
    issuer: { chain: token.chain, markPrice: token.markPrice, change30d: token.change30d === null ? null : token.change30d / 100 },
  };
}

export function venueName(venue: string) { return VENUE_NAMES[venue] ?? venue; }

/** The coverage payload, with each company worked out once and every market flattened. */
export function useProData() {
  const coverage = useRemoteData<CoveragePayload>("/api/coverage", true);
  const companies = useMemo(() => (coverage.data?.companies ?? []).map(companyView), [coverage.data]);
  const markets = useMemo<FlatMarket[]>(() => companies.flatMap((company) => [
    ...company.rows.map((row) => ({ ...row, company })),
    ...company.issuers.map((token) => issuerMarket(company, token)),
  ]), [companies]);
  const totals = useMemo(() => {
    const sum = (pick: (company: CompanyView) => number) => companies.reduce((total, company) => total + pick(company), 0);
    return {
      volume24: sum((company) => company.totals.volume24hUsd),
      volume30: sum((company) => company.totals.volume30dUsd),
      openInterest: sum((company) => company.totals.openInterestUsd),
      fees: sum((company) => company.totals.estFees30dUsd),
      offchain: sum((company) => company.offchainValuation ?? 0),
      venues: [...new Set(markets.map((market) => market.venue))],
      providers: [...new Set(markets.map((market) => market.provider))],
    };
  }, [companies, markets]);
  return { ...coverage, companies, markets, totals };
}

/** The latest funding round with a disclosed valuation, per company, from the market-data route. */
export type LastRound = { name: string | null; date: string | null; valuation: number };

export function useLastRounds(slugs: readonly string[]) {
  const key = slugs.join(",");
  const [rounds, setRounds] = useState<Record<string, LastRound | null>>({});
  useEffect(() => {
    if (!key) { return; }
    let active = true;
    void Promise.all(key.split(",").map(async (slug): Promise<[string, LastRound | null]> => {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(slug)}/market-data`, { cache: "no-store" });
        if (!response.ok) { return [slug, null]; }
        const body = await response.json() as CompanyMarketData;
        const latest = [...(body.fundingRounds ?? [])]
          .filter((round) => round.valuation !== null && round.valuation > 0)
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];
        return [slug, latest ? { name: latest.series, date: latest.date, valuation: latest.valuation! } : null];
      } catch { return [slug, null]; }
    })).then((entries) => { if (active) { setRounds(Object.fromEntries(entries)); } });
    return () => { active = false; };
  }, [key]);
  return rounds;
}

/**
 * Change of a company's lead-market daily close over `days`, or null when the
 * series is too short to reach back that far (a shorter window is not the same figure).
 */
export function seriesChange(company: CompanyView, days: number): number | null {
  const closes = company.series.map((point) => point.close);
  return closes.length > days ? changeOver(closes, days) : null;
}

export function monthYear(value: string | null) {
  if (!value) { return "—"; }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date) : "—";
}

export function fullUsd(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) || value === 0 ? "—" : `$${Math.round(value).toLocaleString("en-US")}`;
}

export function share(part: number, whole: number) {
  if (!(whole > 0) || !(part > 0)) { return "—"; }
  const value = part / whole * 100;
  return value < 0.1 ? "<0.1%" : `${value.toFixed(1)}%`;
}

/** A signed change in mono, coloured by sign. */
export function PChg({ value, arrow = false }: { value: number | null; arrow?: boolean }) {
  if (value === null || !Number.isFinite(value)) { return <span className="p-mono p-flat">—</span>; }
  const tone = Math.abs(value) < 0.00005 ? "p-flat" : value > 0 ? "p-up" : "p-down";
  return <span className={`p-mono ${tone}`}>{arrow && tone !== "p-flat" ? (value > 0 ? "▲ " : "▼ ") : ""}{formatSignedPercent(value)}</span>;
}

/** Annualized funding, coloured by who pays. */
export function PFund({ value }: { value: number | null }) {
  const tone = value === null ? "p-flat" : value > 0 ? "p-up" : value < 0 ? "p-down" : "p-flat";
  return <span className={`p-mono ${tone}`}>{fundingText(value)}</span>;
}

/** A spot price against the off-chain share price: "+4.2% premium" or "−12% discount". */
export function PPremium({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) { return <span className="p-flat">—</span>; }
  if (Math.abs(value) < 0.0005) { return <span className="p-prem flat">at par</span>; }
  return <span className={`p-prem ${value > 0 ? "up" : "down"}`}>{formatSignedPercent(value)}<small>{value > 0 ? " premium" : " discount"}</small></span>;
}

export function TypeTag({ type }: { type: AssetType }) {
  return <span className={`p-tag p-tag-${type}`}>{TYPE_INFO[type].tag}</span>;
}

/** A bar growing either way from a centre tick. */
export function PDivBar({ value, max, width = 72 }: { value: number; max: number; width?: number }) {
  const half = max > 0 ? Math.min(Math.abs(value) / max, 1) * 50 : 0;
  return <span className="p-divbar" style={{ width }} aria-hidden>
    <span className={value >= 0 ? "up" : "down"} style={{ left: `${value >= 0 ? 50 : 50 - half}%`, width: `${half}%` }} />
  </span>;
}

/** A horizontal share bar. */
export function PShare({ value, width = 80, colour }: { value: number; width?: number | string; colour?: string }) {
  return <span className="p-share" style={{ width }} aria-hidden><span style={{ width: `${Math.max(Math.min(value, 1) * 100, value > 0 ? 1.5 : 0)}%`, background: colour }} /></span>;
}

/** "Figure 1 · Title" heading used by every Pro panel. */
export function PHead({ title, id, aside, note, children }: { title: ReactNode; id?: string; aside?: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return <div className="p-panel-head">
    <div className="p-panel-title">
      <h2 id={id}>{title}</h2>
      {note && <p className="mk-note">{note}</p>}
    </div>
    {aside && <span className="p-panel-aside">{aside}</span>}
    {children}
  </div>;
}

export function PEmpty({ children }: { children: ReactNode }) {
  return <div className="p-empty">{children}</div>;
}


/** The asset-type note, worded as in Lite: what a perp's quote means. */
export function AssetTypeTip() {
  return <InfoTip label="Asset types">
    Perpetuals are cash-settled contracts on what traders expect the company to be worth, not shares. Most pre-IPO perps quote the company valuation divided by a notional share count (Binance&apos;s OpenAI contract uses 1 billion), so a $1,228 OpenAI perp means about a $1.23T valuation, not a $1,228 share. A few quote one share instead (trade.xyz&apos;s ANT). Compare perps on implied valuation, not price. Spot tokens are issuer tokens that track a share.
  </InfoTip>;
}

/** The share price to show: off-chain, or market-implied once the company has listed. */
export function sharePrice(company: CompanyView): number | null {
  return company.listed ? company.impliedSharePrice : company.offchainPrice;
}

/** "Listed · Nasdaq ANT", for a company that has listed publicly. */
export function ListedBadge({ listed }: { listed: NonNullable<CompanyView["listed"]> }) {
  return <span className="p-listed" title={`Listed on ${listed.exchange} as ${listed.ticker} since ${listed.since}. The off-chain valuation is the current off-chain share price × total shares.`}>Listed · {listed.exchange} {listed.ticker}</span>;
}

/**
 * How a company's off-chain valuation was derived ("price × shares" or "last
 * round"), when the coverage payload says. Read loosely: the field is being
 * added to the payload separately and may be absent.
 */
export function valuationBasis(company: CompanyView): string | null {
  const loose = company as CompanyView & { valuationBasis?: unknown; offchainValuationBasis?: unknown };
  const basis = loose.offchainValuationBasis ?? loose.valuationBasis;
  return typeof basis === "string" && basis ? basis : null;
}

/** Exchange cell: overlapping provider/venue logos, the provider's name, and the venue under it when different. */
export function Exchange({ provider, venue, sub }: { provider: string; venue: string | null; sub?: string }) {
  const different = !!venue && provider !== venue && logoKey(provider) !== logoKey(venue);
  return <span className="p-xm">
    <ExchangeMark provider={provider} venue={venue} size={26} />
    <span className="p-xm-text"><strong>{provider}</strong>{(sub ?? (different ? `on ${venue}` : null)) && <small>{sub ?? `on ${venue}`}</small>}</span>
  </span>;
}

/** A market ticker as a link to trade it, with the external-link mark. */
export function Pair({ label, url, where }: { label: string; url: string | null | undefined; where: string }) {
  return url ? <a className="p-pairlink p-mono" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${label} on ${where}`}>{label}<ExternalLink size={12} /></a>
    : <span className="p-pairlink p-mono">{label}</span>;
}
