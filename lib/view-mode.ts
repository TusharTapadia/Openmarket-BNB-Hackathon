/**
 * Lite or Pro: which version of the Markets UI to render.
 *
 * Kept in a cookie rather than a `?view=` param (that param already means
 * "watchlist" on the home page) or localStorage (which the server cannot read):
 * the root layout reads the cookie, so the first server render is already the
 * right mode and nothing flickers from Lite to Pro after hydration.
 */
export type ViewMode = "lite" | "pro";

export const VIEW_MODE_COOKIE = "markets-view";
export const DEFAULT_VIEW_MODE: ViewMode = "lite";
/** One year, in seconds. */
export const VIEW_MODE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseViewMode(value: string | null | undefined): ViewMode {
  return value === "pro" ? "pro" : DEFAULT_VIEW_MODE;
}
