import { beforeAll, expect, test, vi } from "vitest";
import type * as ToneJs from "tone";
import { instantiate } from "../catalogue/instantiate";
import { defineItem, frequency, output, toneCode } from "../catalogue/kit";
import { loadRealTone, webAudio } from "../testing/real-tone";
import { diffRack, emptyRackState } from "./diff";
import { rootRack, type RackState } from "./model";
import { createRenderer } from "./renderer";

// What the renderer does with real Tone where a fake would only say what the
// test expects: params driven through their jacks.

let tone: typeof ToneJs;
beforeAll(async () => {
  tone = await loadRealTone();
});

const filter = defineItem("components", "Filter", {
  description: "A filter.",
  // Kept where the test can reach the node the sandbox would build.
  code: toneCode("(globalThis.builtFilter = new tone.Filter())"),
  params: { params: [frequency({ defaultValue: 1000, patchable: true })] },
});

const signal = defineItem("signals", "Signal", {
  description: "A constant.",
  code: toneCode("new tone.Signal(300)"),
  jacks: [output()],
});

const speakers = defineItem("outputs", "Gain", {
  description: "Somewhere for signal to go.",
  code: toneCode("new tone.Gain()"),
});

const place = (...items: [string, typeof filter][]): RackState => {
  const state = { ...emptyRackState, racks: { root: rootRack } } as RackState;
  return items.reduce((held, [id, item]) => {
    const placed = instantiate(item, id);
    return {
      ...held,
      racks: { ...held.racks, [id]: { ...placed.rack, parentId: "root" } },
      jacks: { ...held.jacks, ...placed.jacks },
      paramGroups: {
        ...held.paramGroups,
        [placed.paramGroup.id]: placed.paramGroup,
      },
      values: { ...held.values, ...placed.values },
    };
  }, state);
};

const builtFilter = () =>
  (globalThis as unknown as { builtFilter: ToneJs.Filter }).builtFilter;

const withPatches = (state: RackState, ...pairs: [string, string][]) => ({
  ...state,
  patches: Object.fromEntries(
    pairs.map(([from, to], index) => [
      `p${index}`,
      { id: `p${index}`, name: `p${index}`, from, to },
    ]),
  ),
});

const setup = () => {
  const errors: string[] = [];
  const renderer = createRenderer({ tone, report: (m) => errors.push(m) });
  let state = emptyRackState;
  const go = (next: RackState) => {
    renderer.apply(diffRack(state, next));
    state = next;
  };
  return { errors, go };
};

test("drives a patched param and gives it its value back after", () => {
  const { errors, go } = setup();
  const base = place(["F", filter], ["S", signal]);
  go(base);
  const built = builtFilter();

  go(withPatches(base, ["S:out", "F:mod:frequency"]));
  expect(built.frequency.overridden).toBe(true);

  go(withPatches(base));
  expect(built.frequency.overridden).toBe(false);
  expect(built.frequency.value).toBeCloseTo(1000);
  expect(errors).toEqual([]);
});

test("leaves a value set while driven for when the patch goes", () => {
  const { go } = setup();
  const base = place(["F", filter], ["S", signal]);
  go(base);
  const built = builtFilter();

  const patched = withPatches(base, ["S:out", "F:mod:frequency"]);
  go(patched);
  go({ ...patched, values: { ...patched.values, "F:param:frequency": 2000 } });
  expect(built.frequency.overridden).toBe(true);

  go({
    ...withPatches(base),
    values: { ...base.values, "F:param:frequency": 2000 },
  });
  expect(built.frequency.value).toBeCloseTo(2000);
});

test("unpatching a param leaves the source's other cables alone", () => {
  const { errors, go } = setup();
  const base = place(["F", filter], ["S", signal], ["G", speakers]);
  go(withPatches(base, ["S:out", "F:mod:frequency"], ["S:out", "G:in"]));

  const disconnect = vi.spyOn(webAudio.AudioNode.prototype, "disconnect");
  go(withPatches(base, ["S:out", "G:in"]));

  expect(disconnect).toHaveBeenCalled();
  expect(disconnect.mock.calls.every((args) => args.length > 0)).toBe(true);
  disconnect.mockRestore();
  expect(errors).toEqual([]);
});

test("reads what each readout rack shows, and nothing else", () => {
  const renderer = createRenderer({ tone, report: () => {} });
  const meter = defineItem("components", "Meter", {
    description: "A level.",
    code: toneCode("new tone.Meter()"),
    readout: { kind: "level" },
  });
  const fft = defineItem("components", "FFT", {
    description: "A spectrum.",
    code: toneCode("new tone.FFT(64)"),
    readout: { kind: "spectrum" },
  });
  renderer.apply(
    diffRack(emptyRackState, place(["M", meter], ["F", fft], ["G", speakers])),
  );

  const values = renderer.readouts();

  expect(Object.keys(values).sort()).toEqual(["F", "M"]);
  expect(typeof values.M).toBe("number");
  expect(values.F).toBeInstanceOf(Float32Array);
  expect((values.F as Float32Array).length).toBe(64);
});
