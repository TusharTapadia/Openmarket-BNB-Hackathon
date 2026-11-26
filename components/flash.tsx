"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Wraps a figure and flashes it green when `value` rises and red when it
 * falls, after a data refresh. The first value and unchanged values do not
 * flash. The class is toggled on the element directly, so a flash costs no
 * extra render; under reduced motion the colour shows without the fade.
 */
export function Flash({ value, children, className = "" }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    const element = ref.current;
    if (!element || before === null || before === undefined || value === null || value === undefined || before === value) { return; }
    const direction = value > before ? "flash-up" : "flash-down";
    element.classList.remove("flash-up", "flash-down");
    // Restart the animation when two moves land close together.
    void element.offsetWidth;
    element.classList.add(direction);
    element.setAttribute("data-moved", direction === "flash-up" ? "up" : "down");
    const timer = setTimeout(() => { element.classList.remove(direction); element.removeAttribute("data-moved"); }, 1800);
    return () => clearTimeout(timer);
  }, [value]);

  return <span ref={ref} className={`flash ${className}`}>{children}</span>;
}
