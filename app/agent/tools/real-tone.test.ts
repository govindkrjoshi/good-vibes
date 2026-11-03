import { beforeAll, expect, test } from "vitest";
import type * as ToneJs from "tone";
import { diffRack, emptyRackState } from "../../rack/diff";
import { createRenderer } from "../../rack/renderer";
import { useStore } from "../../stores";
import { loadRealTone } from "../../testing/real-tone";
import { createRackTools } from ".";

// A rack written the way the tool description tells the agent to write one
// has to build in the renderer, with its params set and its jacks patched;
// and one that breaks the contract has to be reported, not swallowed.

let tone: typeof ToneJs;
beforeAll(async () => {
  tone = await loadRealTone();
});

const initial = useStore.getState();
const tools = createRackTools(useStore);
const call = (name: string, args: object) =>
  tools.find((held) => held.name === name)!.execute("call", args);

const render = () => {
  const errors: string[] = [];
  const renderer = createRenderer({ tone, report: (m) => errors.push(m) });
  renderer.apply(diffRack(emptyRackState, useStore.getState().rack));
  renderer.reset();
  return errors;
};

const wobble = {
  name: "Wobble",
  description: "A slow filter wobble.",
  category: "effects",
  code: `Effect.gen(function* () {
  const { tone } = yield* RenderContext;
  return new tone.AutoFilter(0.5).start();
})`,
  params: {
    params: [
      {
        name: "Wet",
        kind: "number",
        path: ["wet"],
        defaultValue: 1,
        min: 0,
        max: 1,
        patchable: true,
      },
      {
        name: "Depth",
        kind: "number",
        path: ["depth"],
        defaultValue: 0.8,
        min: 0,
        max: 1,
      },
    ],
    groups: {
      filter: {
        name: "Filter",
        params: [
          {
            name: "Type",
            kind: "select",
            path: ["filter", "type"],
            defaultValue: "lowpass",
            options: [{ value: "lowpass" }, { value: "highpass" }],
          },
        ],
      },
    },
  },
};

test("a rack the agent writes builds and plays with real Tone", async () => {
  useStore.setState(initial, true);
  await call("add_rack", { item: "tone/Oscillator", id: "osc" });
  await call("create_rack", { spec: wobble, id: "wob" });
  await call("add_rack", { item: "tone/LFO", id: "lfo" });
  await call("add_rack", { item: "tone/Destination", id: "out" });
  await call("connect", { from: "osc:out", to: "wob:in" });
  await call("connect", { from: "wob:out", to: "out:in" });
  await call("connect", { from: "lfo:out", to: "wob:mod:wet" });
  await call("set_params", {
    values: [
      { paramId: "wob:param:depth", value: 0.5 },
      { paramId: "wob:param:filter.type", value: "highpass" },
    ],
  });

  expect(useStore.getState().rack.errors).toEqual([]);
  expect(render()).toEqual([]);
});

test("a wrong param path or failing code is reported by name", async () => {
  useStore.setState(initial, true);
  await call("create_rack", {
    spec: {
      ...wobble,
      params: {
        params: [
          {
            name: "Wobbliness",
            kind: "number",
            path: ["wobbliness"],
            defaultValue: 1,
          },
        ],
      },
    },
    id: "wob",
  });
  await call("create_rack", {
    spec: {
      ...wobble,
      name: "Broken",
      code: `Effect.gen(function* () {
  yield* Effect.fail(new LeafError({ message: "no such node" }));
})`,
      params: {},
    },
    id: "broken",
  });

  expect(render()).toEqual([
    "Wobbliness can't be set: AutoFilter has no wobbliness",
    "Broken can't be built: no such node",
  ]);
});
