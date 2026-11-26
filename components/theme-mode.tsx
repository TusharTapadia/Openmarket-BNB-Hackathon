"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { useViewMode } from "./view-mode";
import { defaultTheme, THEME_COOKIE, THEME_MAX_AGE, type Theme } from "./theme-cookie";

type ThemeState = { theme: Theme; setTheme: (theme: Theme) => void };

const ThemeContext = createContext<ThemeState>({ theme: "light", setTheme: () => {} });

/**
 * Holds the light / dark choice. Seeded from the cookie the layout read, so
 * the server render and hydration agree. Without a stored choice the scheme
 * follows the view (Lite light, Pro dark); a pick writes the cookie and sets
 * <html data-theme> at once, which the colourways in app/markets.css and
 * app/theme.css key off, so portals and the wallet modal follow too.
 */
export function ThemeProvider({ initial, children }: { initial: Theme | null; children: ReactNode }) {
  const { mode } = useViewMode();
  const [chosen, setChosen] = useState<Theme | null>(initial);
  const theme = chosen ?? defaultTheme(mode);

  // Keeps the attribute in step when the view changes and no scheme was picked.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_MAX_AGE}; samesite=lax`;
    document.documentElement.dataset.theme = next;
    setChosen(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** The sun / moon button beside the Lite / Pro switch in both headers. */
export function ThemeToggle({ tone = "light" }: { tone?: "light" | "pro" }) {
  const { theme, setTheme } = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = `Switch to ${next} mode`;
  return (
    <button type="button" className={`theme-toggle ${tone === "pro" ? "theme-toggle-pro" : ""}`}
      onClick={() => setTheme(next)} aria-label={label} title={label}>
      {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
    </button>
  );
}
