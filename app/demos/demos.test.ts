import { beforeAll, expect, test } from "vitest";
import type * as ToneJs from "tone";
import { emptyRegistry, loadPlugin } from "../catalogue/registry";
import { tonePlugin } from "../catalogue/plugins/tone";
import { diffRack, emptyRackState } from "../rack/diff";
import { canPatch } from "../rack/model";
import { createRenderer } from "../rack/renderer";
import { loadRealTone } from "../testing/real-tone";
import { DemoBuilder, inp, out, seq } from "./builder";
import { demos, rackCount } from ".";
import { furEliseSeconds } from "./fur-elise";

const registry = loadPlugin(emptyRegistry, tonePlugin);

let tone: typeof ToneJs;
beforeAll(async () => {
  tone = await loadRealTone();
});

const sizes: Record<string, number> = {
  "dub-pulse": 10,
  "sidechain-garden": 20,
  "fur-elise": 33,
  "generative-session": 100,
};

test.each(demos.map((demo) => [demo.id, demo] as const))(
  "%s builds at its size, patched end to end into the speakers",
  (id, demo) => {
    const state = demo.build(registry);

    expect(rackCount(state)).toBe(sizes[id]);
    const speakers = Object.values(state.racks).filter(
      (rack) => rack.name === "Destination",
    );
    expect(speakers).toHaveLength(1);
    expect(
      Object.values(state.patches).some(
        (patch) => patch.to === `${speakers[0]!.id}:in`,
      ),
    ).toBe(true);
    for (const patch of Object.values(state.patches)) {
      const from = state.jacks[patch.from]!;
      const to = state.jacks[patch.to]!;
      expect(canPatch(state.racks, from, to)).toBe(true);
    }
    // Every rack but the root is in its parent's children, and no rack is
    // left out of the signal flow.
    for (const rack of Object.values(state.racks)) {
      if (rack.isRoot) continue;
      const parent = state.racks[rack.parentId!];
      expect(parent?.type === "tree" && parent.children).toContain(rack.id);
      const patched = Object.values(state.patches).some(
        (patch) =>
          state.jacks[patch.from]?.belongToBlockId === rack.id ||
          state.jacks[patch.to]?.belongToBlockId === rack.id,
      );
      expect(patched, `${rack.id} is patched`).toBe(true);
    }
    expect(state.transport.playing).toBe(false);
  },
);

test.each(demos.map((demo) => [demo.id, demo] as const))(
  "%s renders with real Tone without a complaint",
  (_, demo) => {
    const errors: string[] = [];
    const renderer = createRenderer({ tone, report: (m) => errors.push(m) });
    renderer.apply(diffRack(emptyRackState, demo.build(registry)));
    renderer.reset();
    expect(errors).toEqual([]);
  },
);

test("Für Elise plays for over a minute before it comes round", () => {
  const state = demos.find((demo) => demo.id === "fur-elise")!.build(registry);
  const flute = Object.values(state.events).filter(
    (event) => event.belongToBlockId === "winds.flute",
  );

  expect(furEliseSeconds(state.transport.bpm)).toBeGreaterThan(60);
  // Every part loops over the whole score, and the tune is in sixteenths,
  // eighths and the one long note at the close.
  expect(
    flute.every(
      (event) => event.kind === "part" && event.loopEnd === "0:0:276",
    ),
  ).toBe(true);
  expect(flute.map((event) => event.args.duration).sort()).toEqual([
    "0:0:1",
    "0:0:2",
    "0:0:6",
  ]);
  const steps = flute.flatMap((event) =>
    event.kind === "part" ? event.steps : [],
  );
  expect(steps.length).toBeGreaterThan(150);
  expect(steps.find((step) => step.time === "0:0:4")?.value).toBe("E5");
  expect(steps.find((step) => step.time === "0:0:6")?.value).toBe("E5");
  expect(steps.find((step) => step.time === "0:0:11")?.value).toBe("C5");
});

test("the builder refuses what the store could not hold", () => {
  const b = new DemoBuilder(registry, 120);
  b.add("tone/Filter", "f");
  b.tree("g", "Group", { outputs: ["Mix"] });

  expect(() => b.add("tone/Theremin", "t")).toThrow("not in the catalogue");
  expect(() => b.add("tone/Filter", "f")).toThrow("already a rack");
  expect(() => b.add("tone/Filter", "x", { parentId: "f" })).toThrow("no tree");
  expect(() => b.add("tone/Filter", "x", { values: { cutoff: 1 } })).toThrow(
    "no param cutoff",
  );
  expect(() =>
    b.add("tone/Filter", "y", {
      events: [seq([1], "8n", {})],
    }),
  ).toThrow("no method");
  expect(() => b.patch(out("f"), inp("nowhere"))).toThrow("no jack");
  expect(() => b.patch(out("f"), inp("f"))).toThrow("can't be patched");
  // Into a group's output from outside it.
  expect(() => b.patch(out("f"), out("g", "mix"))).toThrow("can't be patched");
});

test("the builder names a rack for its part and keeps the item's name", () => {
  const b = new DemoBuilder(registry, 90);
  b.add("tone/Filter", "f", { name: "Dub filter", values: { Q: 7 } });
  b.add("tone/Destination", "out");
  b.chain("f", "out");
  const state = b.build();

  expect(state.racks.f?.name).toBe("Dub filter · Filter");
  expect(state.values["f:param:Q"]).toBe(7);
  expect(state.values["f:param:frequency"]).toBe(350);
  expect(Object.values(state.patches)).toEqual([
    {
      id: "f:out>out:in",
      name: "Output to Input",
      from: "f:out",
      to: "out:in",
    },
  ]);
  expect(state.transport).toEqual({ bpm: 90, playing: false });
});
