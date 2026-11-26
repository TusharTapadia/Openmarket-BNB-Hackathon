"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useRemoteData<T>(path: string | null, poll = false) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; refreshing: boolean }>({
    data: null, error: null, loading: true, refreshing: false,
  });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const currentPath = useRef(path);
  useEffect(() => {
    if (!path) return;
    let active = true;
    let pending = false;
    let controller: AbortController | null = null;
    async function load() {
      if (!active || pending) return;
      pending = true;
      controller = new AbortController();
      // Schedule state changes so the initial render remains stable during hydration.
      await Promise.resolve();
      if (!active) return;
      const changed = currentPath.current !== path;
      currentPath.current = path;
      setState((previous) => ({ ...previous, data: changed ? null : previous.data, loading: changed || !previous.data, refreshing: true }));
      try {
        const response = await fetch(path!, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok) {
          const message = body !== null && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Data is temporarily unavailable.";
          throw new Error(message);
        }
        if (active) setState({ data: body as T, error: null, loading: false, refreshing: false });
      } catch (error) {
        if (active) setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : "Data is temporarily unavailable.", loading: false, refreshing: false }));
      } finally { pending = false; }
    }
    void load();
    const interval = poll ? setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60_000) : null;
    return () => { active = false; controller?.abort(); if (interval) clearInterval(interval); };
  }, [path, revision, poll]);
  return { ...state, refresh };
}
