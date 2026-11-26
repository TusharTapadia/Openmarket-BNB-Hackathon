"use client";

import { Info } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

const GAP = 8;
const MARGIN = 10;

/**
 * A short explanation attached to a label.
 *
 * Hand-rolled rather than pulled from the UI kit: these sit inside table
 * headers and stat rows this site already lays out with its own CSS, and a
 * positioned popover library would fight that for the sake of one icon.
 *
 * The bubble is fixed-positioned and placed from the trigger's measured rect.
 * An absolutely-positioned one is clipped by the venue tables, which scroll
 * horizontally -- `overflow-x: auto` clips the vertical axis too, so anything
 * escaping the header row is cut off. Fixed positioning sidesteps every
 * clipping ancestor instead of special-casing the ones we know about.
 *
 * Opens on hover and on focus: a tap focuses the button on a touch screen,
 * where there is no hover, and tapping elsewhere blurs it shut. A click handler
 * on top of that would fire straight after focus and close the tip the moment
 * it opened.
 */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  // Written straight to the node rather than held in state: the bubble must be
  // measured before it can be placed, and a state round trip would paint it at
  // its last position first -- which is what put a tip halfway down the page.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = bubble;
    const limit = Math.max(window.innerWidth - width - MARGIN, MARGIN);
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, MARGIN), limit);
    // Above by default, below when the top of the window is in the way.
    const above = anchor.top - height - GAP >= MARGIN;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(above ? anchor.top - height - GAP : anchor.bottom + GAP)}px`;
    // Revealed here, in the same step that positions it, so it can never paint
    // at the coordinates the previous tip left behind. Inline rather than via a
    // class so showing it does not depend on the cascade.
    bubble.style.visibility = "visible";
    bubble.style.opacity = "1";
  }, []);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!open) {
      if (bubble) {
        bubble.style.visibility = "";
        bubble.style.opacity = "";
      }
      return;
    }
    place();
    // A scroll moves the trigger out from under a bubble that is no longer
    // tied to it, so the tip closes rather than drifting away from its label.
    const dismiss = () => setOpen(false);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, place]);

  return (
    <span className="info-tip">
      <button
        ref={triggerRef}
        type="button"
        className="info-tip-trigger"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => event.preventDefault()}
        onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); } }}
      >
        <Info size={12} aria-hidden />
      </button>
      {/* Rendered whenever open so it can be measured, but only shown once it
          has been placed -- otherwise it flashes at the previous coordinates. */}
      <span ref={bubbleRef} role="tooltip" id={id} className="info-tip-bubble">
        {children}
      </span>
    </span>
  );
}
