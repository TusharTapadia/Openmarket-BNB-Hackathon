"use client";
import { useSyncExternalStore } from "react";
const KEY = "precap-watchlist";
const EVENT = "precap-watchlist-change";
const empty: string[] = [];
let cacheValue: string | null = null;
let cacheItems: string[] = empty;
function snapshot() {
  try {
    const value = localStorage.getItem(KEY);
    if (value === cacheValue) return cacheItems;
    const parsed: unknown = value ? JSON.parse(value) : [];
    cacheValue = value;
    cacheItems = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : empty;
    return cacheItems;
  } catch { return cacheItems; }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback); };
}
export function useWatchlist() {
  const watchlist = useSyncExternalStore(subscribe, snapshot, () => empty);
  function toggleWatch(slug: string) {
    const items = snapshot();
    const next = items.includes(slug) ? items.filter((item) => item !== slug) : [...items, slug];
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch {
      // Keep the watchlist usable in memory when browser storage is disabled.
      cacheItems = next;
    }
    window.dispatchEvent(new Event(EVENT));
  }
  return { watchlist, toggleWatch };
}
