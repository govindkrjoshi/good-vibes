import { beforeEach, expect, test } from "vitest";
import { applyAction, describeRack } from "./index";
import type { RackAction } from "../agent";
import { rackStore } from "../rack";

const initial = rackStore.getState();
const state = () => rackStore.getState();

beforeEach(() => {
  rackStore.setState(initial, true);
});

const apply = (action: RackAction) => applyAction(rackStore, action);

const add = (id: string, category: string, entry: string): string => {
  const result = apply({ kind: "add_block", id, category, entry });
  if (!result.ok) throw new Error(result.text);
  return id;
};

const paramId = (blockId: string, name: string): string => {
  const param = Object.values(state().params).find(
    (held) => held.belongToBlockId === blockId && held.name === name,
  );
  if (param === undefined) throw new Error(`no ${name}`);
  return param.id;
};

test("describes an empty rack and what can be added", () => {
  const result = apply({ kind: "describe" });

  expect(result).toMatchObject({
    ok: true,
    text: "Looked at the rack: 0 blocks, 0 patches.",
  });
  expect(result.data).toEqual({
    catalogue: [
      { category: "source", entry: "AMOscillator", params: [] },
      {
        category: "instruments",
        entry: "AMSynth",
        params: expect.arrayContaining(["volume", "oscillator.type"]),
      },
      { category: "output", entry: "Destination", params: [] },
    ],
    transport: { bpm: 120 },
    blocks: [],
    patches: [],
  });
});

test("adds a block under the id it is given, and says what it has", () => {
  const result = apply({
    kind: "add_block",
    id: "synth-1",
    category: "instruments",
    entry: "AMSynth",
  });

  expect(result).toMatchObject({ ok: true, text: "Added AMSynth as synth-1." });
  const data = result.data as ReturnType<typeof describeRack>["blocks"][number];
  expect(data).toMatchObject({
    id: "synth-1",
    name: "AMSynth",
    hasInput: true,
    hasOutput: true,
  });
  expect(state().blocks["synth-1"]?.name).toBe("AMSynth");
  expect(data.params).toContainEqual({
    id: "synth-1:param:volume",
    name: "Volume",
    kind: "number",
    value: 0,
    min: -60,
    max: 12,
    step: 1,
    unit: "dB",
  });
  expect(data.params).toContainEqual(
    expect.objectContaining({
      name: "Type",
      kind: "select",
      value: "sine",
      options: expect.arrayContaining(["sine", "square"]),
    }),
  );
  expect(data.events).toHaveLength(1);
});

test("refuses a block id that is taken", () => {
  add("synth-1", "instruments", "AMSynth");

  expect(
    apply({
      kind: "add_block",
      id: "synth-1",
      category: "output",
      entry: "Destination",
    }),
  ).toEqual({ ok: false, text: "There is already a block with id synth-1." });
  expect(state().blocks["synth-1"]?.name).toBe("AMSynth");
});

test("refuses an entry the catalogue does not have, and says what it has", () => {
  const result = apply({
    kind: "add_block",
    id: "fx-1",
    category: "fx",
    entry: "Reverb",
  });

  expect(result).toMatchObject({
    ok: false,
    text: "There is no fx/Reverb in the catalogue.",
  });
  expect(result.data).toMatchObject({
    catalogue: expect.arrayContaining([
      expect.objectContaining({ category: "instruments", entry: "AMSynth" }),
    ]),
  });
  expect(Object.keys(state().blocks)).toEqual(["root"]);
});

test("connects one block's output into another's input", () => {
  const synth = add("synth", "instruments", "AMSynth");
  const speakers = add("speakers", "output", "Destination");

  const result = apply({
    kind: "connect_blocks",
    fromBlockId: synth,
    toBlockId: speakers,
  });

  expect(result).toMatchObject({
    ok: true,
    text: "Connected AMSynth to Destination.",
  });
  const { patchId } = result.data as { patchId: string };
  expect(state().patches[patchId]).toMatchObject({
    from: `${synth}:out`,
    to: `${speakers}:in`,
  });
  expect(describeRack(state()).patches).toEqual([
    { id: patchId, from: synth, to: speakers },
  ]);
});

test("says why blocks cannot be connected", () => {
  const synth = add("synth", "instruments", "AMSynth");
  const speakers = add("speakers", "output", "Destination");

  expect(
    apply({ kind: "connect_blocks", fromBlockId: speakers, toBlockId: synth }),
  ).toEqual({ ok: false, text: "Destination has no output to patch from." });
  expect(
    apply({ kind: "connect_blocks", fromBlockId: synth, toBlockId: synth }),
  ).toEqual({ ok: false, text: "AMSynth cannot be patched into AMSynth." });
  expect(
    apply({ kind: "connect_blocks", fromBlockId: "nope", toBlockId: synth }),
  ).toEqual({ ok: false, text: "There is no block with id nope." });
  expect(state().patches).toEqual({});
});

test("disconnects a patch", () => {
  const synth = add("synth", "instruments", "AMSynth");
  const speakers = add("speakers", "output", "Destination");
  const { patchId } = apply({
    kind: "connect_blocks",
    fromBlockId: synth,
    toBlockId: speakers,
  }).data as { patchId: string };

  expect(apply({ kind: "disconnect", patchId })).toEqual({
    ok: true,
    text: "Disconnected AMSynth from Destination.",
  });
  expect(state().patches).toEqual({});
  expect(apply({ kind: "disconnect", patchId })).toEqual({
    ok: false,
    text: "There is no patch with id " + patchId + ".",
  });
});

test("removes blocks by name, and refuses ids it does not know", () => {
  const synth = add("synth", "instruments", "AMSynth");
  const speakers = add("speakers", "output", "Destination");

  expect(apply({ kind: "remove_blocks", blockIds: [synth, "nope"] })).toEqual({
    ok: false,
    text: "There is no block with id nope.",
  });
  expect(Object.keys(state().blocks)).toHaveLength(3);

  expect(apply({ kind: "remove_blocks", blockIds: [synth, speakers] })).toEqual(
    { ok: true, text: "Removed AMSynth, Destination." },
  );
  expect(Object.keys(state().blocks)).toEqual(["root"]);
});

test("sets a param and reports the value kept", () => {
  const synth = add("synth", "instruments", "AMSynth");
  const volume = paramId(synth, "Volume");

  expect(apply({ kind: "set_param", paramId: volume, value: -12 })).toEqual({
    ok: true,
    text: "Set AMSynth Volume to -12 dB.",
    data: { paramId: volume, value: -12 },
  });
  expect(apply({ kind: "set_param", paramId: volume, value: 100 })).toEqual({
    ok: true,
    text: "Set AMSynth Volume to 12 dB (clamped from 100).",
    data: { paramId: volume, value: 12 },
  });
  expect(state().values[volume]).toBe(12);
});

test("says what a param takes when a value is refused", () => {
  const synth = add("synth", "instruments", "AMSynth");
  const volume = paramId(synth, "Volume");
  const type = paramId(synth, "Type");

  expect(apply({ kind: "set_param", paramId: volume, value: "loud" })).toEqual({
    ok: false,
    text: "AMSynth Volume takes a number from -60 to 12.",
  });
  expect(apply({ kind: "set_param", paramId: type, value: "banjo" })).toEqual({
    ok: false,
    text: "AMSynth Type takes one of sine, square, triangle, sawtooth, pulse, pwm, fatsine, fmsine, amsine.",
  });
  expect(apply({ kind: "set_param", paramId: "nope", value: 1 })).toEqual({
    ok: false,
    text: "There is no param with id nope.",
  });
});

test("sets the tempo", () => {
  expect(apply({ kind: "set_transport", bpm: 90 })).toEqual({
    ok: true,
    text: "Set the tempo to 90 bpm.",
  });
  expect(state().transport).toEqual({ bpm: 90 });
  expect(apply({ kind: "set_transport", bpm: 0 })).toEqual({
    ok: false,
    text: "The tempo has to be a number above 0.",
  });
});
