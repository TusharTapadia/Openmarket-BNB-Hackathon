"use client";

import { useEffect, useRef, useState } from "react";

/** Shared pieces of the data-feeds pages: formatting, polling and a ticking clock. */

export const money = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) { return "—"; }
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : 4;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

export const compact = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) { return "—"; }
  const abs = Math.abs(value);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : abs >= 1e3 ? [1e3, "K"] : [1, ""];
  return `$${(value / div).toFixed(div === 1 ? 0 : 2)}${suffix}`;
};

export const signedPct = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) { return "—"; }
  const text = Math.abs(value * 100).toFixed(digits);
  if (Number(text) === 0) { return `${(0).toFixed(digits)}%`; }
  return `${value > 0 ? "+" : "−"}${text}%`;
};

export const bps = (value: number | null | undefined) => value === null || value === undefined ? "—" : `±${(value / 100).toFixed(2)}%`;

/** "4s ago", "12m ago", "3h ago", "2d ago". */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) { return "—"; }
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) { return "—"; }
  if (seconds < 60) { return `${seconds}s ago`; }
  if (seconds < 3600) { return `${Math.floor(seconds / 60)}m ago`; }
  if (seconds < 86_400) { return `${Math.floor(seconds / 3600)}h ago`; }
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export const duration = (seconds: number) => seconds % 3600 === 0 ? `${seconds / 3600}h` : seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

export const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
export const clockSeconds = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const dayTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const dayOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** The current time, re-read every `ms`, for "Ns ago" labels. Starts at 0 so the server render is stable. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, ms);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [ms]);
  return now;
}

/**
 * Fetches `path` and re-fetches every `ms` while the tab is visible, keeping
 * the last good body through errors and refetches.
 */
export function usePoll<T>(path: string | null, ms: number) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const current = useRef(path);
  useEffect(() => {
    if (!path) { return; }
    let active = true;
    let controller: AbortController | null = null;
    const pathChanged = current.current !== path;
    current.current = path;
    async function load(initial: boolean) {
      controller?.abort();
      controller = new AbortController();
      await Promise.resolve();
      if (!active) { return; }
      if (initial && pathChanged) { setState((previous) => ({ ...previous, loading: true })); }
      try {
        const response = await fetch(path!, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as T & { message?: string };
        if (!response.ok) { throw new Error(typeof body?.message === "string" ? body.message : "Data is temporarily unavailable."); }
        if (active) { setState({ data: body, error: null, loading: false }); }
      } catch (error) {
        if (active && (error as Error).name !== "AbortError") {
          setState((previous) => ({ ...previous, error: (error as Error).message || "Data is temporarily unavailable.", loading: false }));
        }
      }
    }
    void load(true);
    const timer = setInterval(() => { if (document.visibilityState === "visible") { void load(false); } }, ms);
    return () => { active = false; controller?.abort(); clearInterval(timer); };
  }, [path, ms]);
  return state;
}
