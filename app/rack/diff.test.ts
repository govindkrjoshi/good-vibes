import { expect, test } from "vitest";
import { applyRackOps, diffRack, emptyRackState } from "./diff";
import type { RackState } from "./model";

const state = (overrides: Partial<RackState>): RackState => ({
  ...emptyRackState,
  ...overrides,
});

test("finds nothing between a state and itself", () => {
  expect(diffRack(emptyRackState, emptyRackState)).toEqual([]);
});

test("finds a nested change by its path", () => {
  const before = state({ values: { a: 1, b: 2 } });
  const after = state({ values: { a: 1, b: 3 } });

  expect(diffRack(before, after)).toEqual([
    { op: "set", path: ["values", "b"], value: 3 },
  ]);
});

test("finds what was added and removed", () => {
  const before = state({ values: { gone: 1 } });
  const after = state({ values: { added: 2 } });

  expect(diffRack(before, after)).toEqual([
    { op: "delete", path: ["values", "gone"] },
    { op: "set", path: ["values", "added"], value: 2 },
  ]);
});

test("replaces an array whole", () => {
  const before = state({ automations: { a: [] } });
  const event = { id: "e", method: "rampTo", value: 1, time: "0" } as const;
  const after = state({ automations: { a: [event] } });

  expect(diffRack(before, after)).toEqual([
    { op: "set", path: ["automations", "a"], value: [event] },
  ]);
});

test("ignores anything that isn't the rack's data", () => {
  const before = { ...emptyRackState, errors: [] };
  const after = { ...emptyRackState, errors: ["oops"] };

  expect(diffRack(before, after)).toEqual([]);
});

test("applying a diff gets from the old state to the new one", () => {
  const before = state({
    values: { gone: 1, kept: 2 },
    transport: { bpm: 100, playing: false },
  });
  const after = state({
    values: { kept: 3, added: 4 },
    transport: { bpm: 100, playing: true },
  });

  expect(applyRackOps(before, diffRack(before, after))).toEqual(after);
  expect(before.values).toEqual({ gone: 1, kept: 2 });
});
