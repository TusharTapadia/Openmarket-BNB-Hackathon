/**
 * The Openmarkets mark: an open ring, the "O", with a rising price line that
 * breaks out through the gap. A private market opening up. Drawn in
 * currentColor so it takes the ink of wherever it sits; the favicon at
 * app/icon.svg is the same drawing.
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {/* The ring, open at the upper right */}
    <path d="M18.93 16A8 8 0 1 1 14.07 4.27" />
    {/* The price line: flat inside, then out through the gap */}
    <path d="M7 14.5l3-3 2.5 2.5L20 6.5" />
    <path d="M15.5 6.5H20V11" />
  </svg>;
}
