/**
 * The Openmarkets mark: an open "O" with two rising bars, a private market
 * opening up. The header uses a 128px copy of public/logos/openmarkets-icon.png
 * (the full-size original); the browser tab uses app/icon.png and
 * app/apple-icon.png, made from the same file.
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  // A plain img: the file is a fixed 9 KB asset, so next/image's pipeline would add nothing here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logos/openmarkets-mark.png" width={size} height={size} alt="" aria-hidden="true" className="brand-mark-img" />;
}
