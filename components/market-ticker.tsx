"use client";

import { RefreshCw } from "lucide-react";

/**
 * The figures that describe the whole market, on one line above everything
 * else. Scannable without being read, which is what someone arriving at a
 * market page wants before they want anything else.
 *
 * Shared by the overview and the charts page so the two cannot disagree about
 * what the market is worth at the top of the screen.
 */
export function MarketTicker({ items, loading, error, refreshing, refreshedAt, onRefresh }: {
  items: readonly { label: string; value: string }[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  refreshedAt: string | null;
  onRefresh: () => void;
}) {
  return (
    <div className="ticker-strip">
      <div className="ticker-inner">
        {items.map((item) => (
          <span key={item.label}><em>{item.label}</em> {item.value}</span>
        ))}
        <span className="ticker-spacer" />
        <span className={`ticker-status ${error ? "has-error" : ""}`}>
          <span className={`status-dot ${!loading && !error ? "connected" : ""}`} />
          {error ? "Feed unavailable" : loading ? "Connecting" : `Updated ${refreshedAt} IST`}
        </span>
        <button className="ticker-refresh" type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh market data">
          <RefreshCw size={13} className={refreshing ? "spinning" : ""} />
        </button>
      </div>
    </div>
  );
}

/** The clock format the strip and the charts page both stamp updates with. */
export const IST = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
