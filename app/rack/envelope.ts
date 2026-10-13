// The drawing box an envelope is plotted into.
export const envelopeBox = { width: 240, height: 48, pad: 2 } as const;

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
  const { width, height, pad } = envelopeBox;
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
