/**
 * Light or dark: the colour scheme, chosen independently of Lite / Pro.
 *
 * Stored in a cookie so the root layout can set <html data-theme> on the
 * server and the first paint is already right. With no cookie the scheme
 * follows the view: Lite reads as light paper, Pro as dark graphite. Once a
 * person picks one it sticks across both views.
 *
 * No "use client" here: the server layout and the client toggle share it.
 */
import type { ViewMode } from "@/lib/view-mode";

export type Theme = "light" | "dark";

export const THEME_COOKIE = "markets-theme";
/** One year, in seconds. */
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

/** The stored choice, or null when the person has not picked one. */
export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** What a view looks like before anyone picks: today's look for each. */
export function defaultTheme(mode: ViewMode): Theme {
  return mode === "pro" ? "dark" : "light";
}
