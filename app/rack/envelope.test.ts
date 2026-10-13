import { expect, test } from "vitest";
import { envelopePoints } from "./envelope";

test("draws an envelope from silence, up to full, down to sustain and out", () => {
  const [start, peak, decayed, held, end] = envelopePoints({
    attack: 1,
    decay: 1,
    sustain: 0.5,
    release: 1,
  });

  expect(start[1]).toBe(end[1]);
  expect(peak[1]).toBeLessThan(decayed[1]);
  expect(decayed[1]).toBe(held[1]);
  expect(start[0]).toBeLessThan(peak[0]);
  expect(held[0]).toBeLessThan(end[0]);
});

test("gives longer stages more of the width", () => {
  const [start, peak, decayed] = envelopePoints({
    attack: 2,
    decay: 1,
    sustain: 1,
    release: 1,
  });

  expect(peak[0] - start[0]).toBeCloseTo((decayed[0] - peak[0]) * 2);
});

test("still draws when every stage is instant", () => {
  const points = envelopePoints({
    attack: 0,
    decay: 0,
    sustain: 1,
    release: 0,
  });

  expect(
    points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)),
  ).toBe(true);
});
