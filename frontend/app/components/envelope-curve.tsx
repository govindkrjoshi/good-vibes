const width = 240;
const height = 48;
const pad = 2;

// Sustain is a level, not a time, so it gets a fixed stretch of the drawing;
// attack, decay and release share the rest in proportion to their lengths.
const holdShare = 0.2;

export type Envelope = {
  readonly attack: number;
  readonly decay: number;
  readonly sustain: number;
  readonly release: number;
};

export function envelopePoints({ attack, decay, sustain, release }: Envelope) {
  const span = width - pad * 2;
  const timed = Math.max(attack + decay + release, Number.EPSILON);
  const share = (span * (1 - holdShare)) / timed;
  const level = (amount: number) =>
    pad + (height - pad * 2) * (1 - Math.min(1, Math.max(0, amount)));

  const peakX = pad + attack * share;
  const decayX = peakX + decay * share;
  const releaseX = decayX + span * holdShare;
  const endX = releaseX + release * share;

  return [
    [pad, level(0)],
    [peakX, level(1)],
    [decayX, level(sustain)],
    [releaseX, level(sustain)],
    [endX, level(0)],
  ] as const;
}

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
