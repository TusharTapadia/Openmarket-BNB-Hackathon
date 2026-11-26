/**
 * A week of prices as one small line.
 *
 * Drawn as a bare path with no axes, labels or interaction: at this size the
 * only readable thing is the shape, and a reader who wants the numbers has the
 * change columns beside it and the company page a click away.
 *
 * Coloured by the direction of the series rather than by each segment, so the
 * line answers the same question the percentage beside it does and the two
 * cannot appear to disagree.
 */
export function Sparkline({ values, width = 128, height = 36 }: { values: readonly number[]; width?: number; height?: number }) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length < 2) {
    return <span className="sparkline-empty" aria-hidden>—</span>;
  }

  const low = Math.min(...usable);
  const high = Math.max(...usable);
  // A flat series would divide by zero and, scaled to the full height, would
  // also draw a dramatic line out of no movement. It sits in the middle.
  const span = high - low || 1;
  const pad = 3;
  const inner = height - pad * 2;
  const step = width / (usable.length - 1);

  const points = usable.map((value, index) => {
    const x = index * step;
    const y = high === low ? height / 2 : pad + inner - ((value - low) / span) * inner;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const rising = usable[usable.length - 1] >= usable[0];
  const stroke = rising ? "var(--up)" : "var(--down)";

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${rising ? "Up" : "Down"} over the period shown`}
    >
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
