import { envelopeBox, envelopePoints, type Envelope } from "../../rack";

const { width, height, pad } = envelopeBox;

export function EnvelopeCurve({
  envelope,
  label,
}: {
  readonly envelope: Envelope;
  readonly label: string;
}) {
  const points = envelopePoints(envelope);
  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const floor = height - pad;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-12 w-full overflow-visible rounded-md bg-muted/60 text-primary"
    >
      <polygon
        points={`${pad},${floor} ${line} ${points[4][0]},${floor}`}
        className="fill-current opacity-10"
      />
      {/* The sustain stretch is where the note is held; a dashed marker at its
          start shows where the key-down part of the envelope ends. */}
      <line
        x1={points[2][0]}
        x2={points[2][0]}
        y1={pad}
        y2={floor}
        className="stroke-muted-foreground/40"
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={line}
        fill="none"
        className="stroke-current"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
