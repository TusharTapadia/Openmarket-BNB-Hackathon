"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { formatSignedPercent } from "@/app/data";

/**
 * A signed percentage coloured by direction, or a dash where there is none.
 *
 * A move small enough to round to 0.00% reads as flat rather than as a rise:
 * a green arrow over "0.00%" says the price went up and then prints the
 * evidence that it did not.
 */
export function Change({ value, flatBelow = 0.00005 }: { value: number | null; flatBelow?: number }) {
  if (value === null) { return <span className="muted">—</span>; }
  if (Math.abs(value) < flatBelow) {
    return <span className="change flat"><Minus size={11} aria-hidden />0.00%</span>;
  }
  const rising = value > 0;
  return (
    <span className={`change ${rising ? "up" : "down"}`}>
      {rising ? <TrendingUp size={11} aria-hidden /> : <TrendingDown size={11} aria-hidden />}
      {formatSignedPercent(value).replace(/^[+−]/, "")}
    </span>
  );
}
