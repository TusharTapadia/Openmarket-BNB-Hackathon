"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { VIEW_MODE_COOKIE, VIEW_MODE_MAX_AGE, type ViewMode } from "@/lib/view-mode";

type ViewModeState = { mode: ViewMode; setMode: (mode: ViewMode) => void };

const ViewModeContext = createContext<ViewModeState>({ mode: "lite", setMode: () => {} });

/** Pages that exist only in Pro; switching to Lite on one goes home. */
const PRO_ONLY = ["/overview", "/screener"];

/**
 * Holds the mode for the session. Seeded from the cookie the layout read on
 * the server, so the server render and hydration agree; a switch updates the
 * state at once and writes the cookie for the next request.
 */
export function ViewModeProvider({ initial, children }: { initial: ViewMode; children: ReactNode }) {
  const [mode, setState] = useState<ViewMode>(initial);
  const router = useRouter();
  const pathname = usePathname();
  const setMode = useCallback((next: ViewMode) => {
    document.cookie = `${VIEW_MODE_COOKIE}=${next}; path=/; max-age=${VIEW_MODE_MAX_AGE}; samesite=lax`;
    // The colourway (app/markets.css) keys off this attribute: paper for Lite, graphite for Pro.
    document.documentElement.dataset.mode = next;
    setState(next);
    if (next === "lite" && PRO_ONLY.includes(pathname)) { router.push("/"); }
  }, [pathname, router]);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ViewModeContext.Provider value={value}>{children}</ViewModeContext.Provider>;
}

export function useViewMode() {
  return useContext(ViewModeContext);
}

/** Renders one of two trees by mode, so a server page can offer both. */
export function ModeSwitch({ lite, pro }: { lite: ReactNode; pro: ReactNode }) {
  return <>{useViewMode().mode === "pro" ? pro : lite}</>;
}

/** The Lite / Pro switch shown in both headers. */
export function ViewToggle({ tone = "light" }: { tone?: "light" | "pro" }) {
  const { mode, setMode } = useViewMode();
  return (
    <div className={`view-toggle ${tone === "pro" ? "view-toggle-pro" : ""}`} role="group" aria-label="Interface version">
      {(["lite", "pro"] as const).map((item) => (
        <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}
          title={item === "pro" ? "Detailed institutional view" : "Simple view"}>
          {item === "lite" ? "Lite" : "Pro"}
        </button>
      ))}
    </div>
  );
}
