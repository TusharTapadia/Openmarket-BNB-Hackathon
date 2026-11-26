"use client";

import { BrandMark } from "./brand-mark";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { ViewToggle } from "./view-mode";
import { ThemeToggle } from "./theme-mode";

type View = "markets" | "charts" | "fear-greed" | "watchlist" | "ipo" | "data-feeds";

/**
 * The site's primary navigation, as a row of pills.
 *
 * Overview and Watchlist are two views of one page, so on that page they
 * switch in place rather than navigating; Charts and Fear & Greed are pages of
 * their own and are always links. The caller says which it is by passing
 * `onView` or not.
 */
const ITEMS: { view: View; label: string; href: string; inPlace: boolean }[] = [
  { view: "markets", label: "Markets", href: "/", inPlace: true },
  { view: "charts", label: "Charts", href: "/charts", inPlace: false },
  { view: "fear-greed", label: "Fear & Greed", href: "/fear-greed", inPlace: false },
  { view: "watchlist", label: "Watchlist", href: "/?view=watchlist", inPlace: true },
  { view: "ipo", label: "Pre-IPO → IPO", href: "/ipo", inPlace: false },
  { view: "data-feeds", label: "Data feeds", href: "/data-feeds", inPlace: false },
];

/** Search lives in the header, but only the overview has a list to search. */
export type HeaderSearch = { value: string; onChange: (value: string) => void };

export function MarketHeader({ view = "markets", onView, search }: {
  view?: View;
  onView?: (view: "markets" | "watchlist") => void;
  search?: HeaderSearch;
}) {
  return (
    <header className="pc-header">
      <div className="pc-header-inner">
        <Link href="/" className="pc-brand" aria-label="Openmarkets home">
          <span className="pc-brand-mark" aria-hidden="true">
            <BrandMark size={20} />
          </span>
          <span className="pc-brand-name">Openmarkets</span>
        </Link>
        <nav className="pc-nav" aria-label="Primary">
          {ITEMS.map((item) => {
            const active = view === item.view;
            return onView && item.inPlace ? (
              <button
                key={item.view}
                type="button"
                className="pc-navpill"
                aria-current={active ? "page" : undefined}
                onClick={() => onView(item.view === "watchlist" ? "watchlist" : "markets")}
              >
                {item.label}
              </button>
            ) : (
              <Link key={item.view} className="pc-navpill" aria-current={active ? "page" : undefined} href={item.href}>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="pc-header-tools">
          {search ? (
            <label className="pc-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder="Search markets"
                aria-label="Search companies"
              />
              {search.value && (
                <button type="button" className="pc-search-clear" onClick={() => search.onChange("")} aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </label>
          ) : (
            <span className="pc-currency" aria-label="Prices in US dollars">USD</span>
          )}
          <ViewToggle />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
