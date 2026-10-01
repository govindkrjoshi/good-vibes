import { Effect } from "effect";
import { beforeEach, expect, test } from "vitest";
import { noopRuntime, type ToneRuntime } from "../audio-renderer";
import { useRackStore } from "./rack";
import { hasOutputJack } from "../types/rack";

const initial = useRackStore.getState();

const state = () => useRackStore.getState();
const root = () => state().blocks[state().rootId];

const children = () => {
  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  return block.children;
};

beforeEach(() => {
  useRackStore.setState(initial, true);
});

test("starts as an empty root tree", () => {
  expect(state().rootId).toBe("root");
  expect(Object.keys(state().blocks)).toEqual(["root"]);
  expect(root().type).toBe("tree");
  expect(root().isRoot).toBe(true);
  expect(children()).toEqual([]);
  expect(state().jacks).toEqual({});
  expect(state().patches).toEqual({});
});

test("files each new block under the root and keeps insertion order", () => {
  state().addBlock("leaf");
  state().addBlock("tree");

  const [first, second] = children();
  expect(children()).toHaveLength(2);
  expect(first).not.toBe(second);
  expect(state().blocks[first].type).toBe("leaf");
  expect(state().blocks[second].type).toBe("tree");
});

test("points every added block back at its parent", () => {
  state().addBlock("tree");

  const block = state().blocks[children()[0]];
  expect(block.parentId).toBe("root");
  expect(block.isRoot).toBe(false);
});

test("gives a leaf block code that returns an Effect", () => {
  state().addBlock("leaf");

  const block = state().blocks[children()[0]];
  if (block.type !== "leaf") throw new Error("expected a leaf block");
  expect(Effect.isEffect(block.code())).toBe(true);
});

test("gives a group block its own empty children and patches", () => {
  state().addBlock("tree");

  const block = state().blocks[children()[0]];
  if (block.type !== "tree") throw new Error("expected a tree block");
  expect(block.children).toEqual([]);
  expect(block.patches).toEqual([]);
});

test("gives each new block one input and one output jack", () => {
  state().addBlock("leaf");

  const block = state().blocks[children()[0]];
  const jacks = block.jackIds.map((id) => state().jacks[id]);

  expect(jacks.map((jack) => jack.direction)).toEqual(["in", "out"]);
  expect(jacks.every((jack) => jack.belongToBlockId === block.id)).toBe(true);
});

test("gives every non-root block an output jack to wire out of", () => {
  const leafId = state().addBlock("leaf");
  const treeId = state().addBlock("tree");
  if (leafId === undefined || treeId === undefined) {
    throw new Error("expected blocks to be added");
  }

  const jacks = state().jacks;
  expect(hasOutputJack(state().blocks[leafId], jacks)).toBe(true);
  expect(hasOutputJack(state().blocks[treeId], jacks)).toBe(true);
  expect(hasOutputJack({ ...state().blocks[leafId], jackIds: [] }, jacks)).toBe(
    false,
  );
});

test("adds AMSynth from the instrument catalogue", () => {
  const id = state().addCatalogueBlock("instruments", "AMSynth");
  if (id === undefined) throw new Error("expected AMSynth to be added");

  const block = state().blocks[id];
  if (block.type !== "leaf") throw new Error("expected AMSynth to be a leaf");

  expect(children()).toEqual([id]);
  expect(block.name).toBe("AMSynth");
  expect(block.parentId).toBe("root");
  const harmonicityId = block.paramIds.paramIds?.harmonicity;
  const triggerAttackReleaseId = block.methodIds.find(
    (methodId) => state().methods[methodId]?.method === "triggerAttackRelease",
  );

  expect(harmonicityId).toBeTypeOf("string");
  if (harmonicityId === undefined) throw new Error("missing harmonicity");
  expect(state().params[harmonicityId]).toMatchObject({
    id: harmonicityId,
    belongToBlockId: id,
    kind: "number",
  });
  expect(triggerAttackReleaseId).toBeTypeOf("string");
  if (triggerAttackReleaseId === undefined) {
    throw new Error("missing triggerAttackRelease");
  }
  expect(state().methods[triggerAttackReleaseId]).toMatchObject({
    id: triggerAttackReleaseId,
    belongToBlockId: id,
    method: "triggerAttackRelease",
  });
  expect(
    block.jackIds.map((jackId) => state().jacks[jackId]?.direction),
  ).toEqual(["in", "out"]);
});

test("ignores missing catalogue blocks", () => {
  expect(state().addCatalogueBlock("instruments", "Missing")).toBeUndefined();
  expect(children()).toEqual([]);
});

test("reads a block's output jack off its direction, not its id", () => {
  const blockId = state().addBlock("leaf");
  if (blockId === undefined) throw new Error("expected block to be added");

  const renamed = {
    id: "renamed",
    name: "Out",
    belongToBlockId: blockId,
    direction: "out",
  } as const;

  expect(
    hasOutputJack(
      { ...state().blocks[blockId], jackIds: ["renamed"] },
      {
        ...state().jacks,
        renamed,
      },
    ),
  ).toBe(true);
});

test("exempts the root, which has nothing above it to wire into", () => {
  expect(hasOutputJack(root(), state().jacks)).toBe(true);
});

test("connects output jacks to input jacks on other blocks", () => {
  const fromBlockId = state().addBlock("leaf");
  const toBlockId = state().addBlock("tree");
  if (fromBlockId === undefined || toBlockId === undefined) {
    throw new Error("expected blocks to be added");
  }

  const patchId = state().connectJacks(`${fromBlockId}:out`, `${toBlockId}:in`);

  expect(patchId).toBeTypeOf("string");
  const rootBlock = root();
  expect(rootBlock.type).toBe("tree");
  expect(children()).toEqual([fromBlockId, toBlockId]);
  if (rootBlock.type !== "tree" || patchId === undefined) return;
  expect(rootBlock.patches).toEqual([patchId]);
  expect(state().patches[patchId]).toMatchObject({
    from: `${fromBlockId}:out`,
    to: `${toBlockId}:in`,
  });
});

test("hands back the patch already there rather than doubling it up", () => {
  const fromBlockId = state().addBlock("leaf");
  const toBlockId = state().addBlock("leaf");
  if (fromBlockId === undefined || toBlockId === undefined) {
    throw new Error("expected blocks to be added");
  }

  const first = state().connectJacks(`${fromBlockId}:out`, `${toBlockId}:in`);
  const second = state().connectJacks(`${fromBlockId}:out`, `${toBlockId}:in`);

  expect(second).toBe(first);
  expect(Object.keys(state().patches)).toHaveLength(1);
  const rootBlock = root();
  if (rootBlock.type !== "tree") throw new Error("root is not a tree");
  expect(rootBlock.patches).toEqual([first]);
});

test("rejects invalid jack connections", () => {
  const blockId = state().addBlock("leaf");
  if (blockId === undefined) throw new Error("expected block to be added");

  expect(state().connectJacks(`${blockId}:in`, `${blockId}:out`)).toBe(
    undefined,
  );
  expect(state().connectJacks(`${blockId}:out`, `${blockId}:in`)).toBe(
    undefined,
  );
  expect(state().connectJacks(`${blockId}:out`, "nobody:in")).toBe(undefined);
  expect(state().patches).toEqual({});
});

test("refuses up front the connections it would reject", () => {
  const fromBlockId = state().addBlock("leaf");
  const toBlockId = state().addBlock("leaf");
  if (fromBlockId === undefined || toBlockId === undefined) {
    throw new Error("expected blocks to be added");
  }

  expect(state().canConnectJacks(`${fromBlockId}:out`, `${toBlockId}:in`)).toBe(
    true,
  );
  expect(state().canConnectJacks(`${fromBlockId}:in`, `${toBlockId}:out`)).toBe(
    false,
  );
  expect(
    state().canConnectJacks(`${fromBlockId}:out`, `${fromBlockId}:in`),
  ).toBe(false);
  expect(state().patches).toEqual({});
});

test("hands back the id of the block it added", () => {
  const id = state().addBlock("leaf");

  expect(id).toBeTypeOf("string");
  expect(children()).toEqual([id]);
});

test("leaves the rack alone when run is called", () => {
  state().addBlock("leaf");
  const before = state().blocks;

  state().run();

  expect(state().blocks).toBe(before);
});

test("removes a block with its jacks and the patches wired to it", () => {
  const first = state().addBlock("leaf");
  const second = state().addBlock("leaf");
  const third = state().addBlock("tree");
  if (first === undefined || second === undefined || third === undefined)
    throw new Error("blocks not added");

  const cut = state().connectJacks(`${first}:out`, `${second}:in`);
  const kept = state().connectJacks(`${second}:out`, `${third}:in`);
  if (cut === undefined || kept === undefined)
    throw new Error("patches not made");

  state().removeBlocks([first]);

  expect(children()).toEqual([second, third]);
  expect(state().blocks[first]).toBeUndefined();
  expect(state().jacks[`${first}:in`]).toBeUndefined();
  expect(state().jacks[`${first}:out`]).toBeUndefined();
  expect(state().patches[cut]).toBeUndefined();
  expect(state().patches[kept]).toBeDefined();

  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  expect(block.patches).toEqual([kept]);
});

test("removes a block with its params and methods", () => {
  const id = state().addCatalogueBlock("instruments", "AMSynth");
  if (id === undefined) throw new Error("expected AMSynth to be added");

  const block = state().blocks[id];
  const harmonicityId = block.paramIds.paramIds?.harmonicity;
  const methodId = block.methodIds[0];
  if (harmonicityId === undefined || methodId === undefined) {
    throw new Error("expected normalized params and methods");
  }

  state().removeBlocks([id]);

  expect(state().params[harmonicityId]).toBeUndefined();
  expect(state().methods[methodId]).toBeUndefined();
});

test("removes several blocks at once", () => {
  const first = state().addBlock("leaf");
  const second = state().addBlock("tree");
  if (first === undefined || second === undefined)
    throw new Error("blocks not added");

  state().removeBlocks([first, second]);

  expect(children()).toEqual([]);
  expect(state().jacks).toEqual({});
});

test("never removes the root or blocks it does not hold", () => {
  state().addBlock("leaf");
  const before = state();

  state().removeBlocks([before.rootId, "no-such-block"]);

  expect(state()).toBe(before);
});

test("removes a patch and leaves its blocks and jacks", () => {
  const first = state().addBlock("leaf");
  const second = state().addBlock("leaf");
  if (first === undefined || second === undefined)
    throw new Error("blocks not added");

  const patch = state().connectJacks(`${first}:out`, `${second}:in`);
  if (patch === undefined) throw new Error("patch not made");

  state().removePatches([patch]);

  expect(state().patches[patch]).toBeUndefined();
  expect(children()).toEqual([first, second]);
  expect(state().jacks[`${first}:out`]).toBeDefined();

  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  expect(block.patches).toEqual([]);
});

test("ignores patches the root does not hold", () => {
  state().addBlock("leaf");
  const before = state();

  state().removePatches(["no-such-patch"]);

  expect(state()).toBe(before);
});

test("lists every category", () => {
  expect(state().categories()).toEqual(["source", "instruments", "output"]);
});

test("lists the sub categories of a category", () => {
  expect(
    state()
      .subCategories("source")
      .map((entry) => entry.name),
  ).toEqual(["AMOscillator"]);
});

test("has no sub categories for an unknown category", () => {
  expect(state().subCategories("nope")).toEqual([]);
});

const addSynth = () => {
  const id = state().addCatalogueBlock("instruments", "AMSynth");
  if (id === undefined) throw new Error("expected AMSynth to be added");
  const block = state().blocks[id];
  const param = (key: string, group?: string) => {
    const paramId =
      group === undefined
        ? block.paramIds.paramIds?.[key]
        : block.paramIds.groups?.[group]?.paramIds?.[key];
    if (paramId === undefined) throw new Error(`missing param ${key}`);
    return paramId;
  };
  const method = (name: string) => {
    const methodId = block.methodIds.find(
      (held) => state().methods[held]?.method === name,
    );
    if (methodId === undefined) throw new Error(`missing method ${name}`);
    return methodId;
  };
  return { id, param, method };
};

test("starts every catalogue param at its default value", () => {
  const synth = addSynth();

  expect(state().values[synth.param("harmonicity")]).toBe(3);
  expect(state().values[synth.param("type", "oscillator")]).toBe("sine");
});

test("sets a param value, clamped into its range", () => {
  const synth = addSynth();
  const volume = synth.param("volume");

  state().setParamValue(volume, -12);
  expect(state().values[volume]).toBe(-12);

  state().setParamValue(volume, 100);
  expect(state().values[volume]).toBe(12);
});

test("refuses a value that does not fit the param", () => {
  const synth = addSynth();
  const type = synth.param("type", "oscillator");
  const volume = synth.param("volume");

  state().setParamValue(type, "banjo");
  state().setParamValue(volume, "loud");

  expect(state().values[type]).toBe("sine");
  expect(state().values[volume]).toBe(0);
});

test("schedules and removes automation on a param", () => {
  const synth = addSynth();
  const volume = synth.param("volume");

  const eventId = state().addAutomation(volume, {
    method: "rampTo",
    value: -6,
    time: "0",
    rampTime: "1",
  });
  if (eventId === undefined) throw new Error("expected automation");

  expect(state().automations[volume]).toEqual([
    { id: eventId, method: "rampTo", value: -6, time: "0", rampTime: "1" },
  ]);

  state().removeAutomation(volume, eventId);
  expect(state().automations[volume]).toEqual([]);
});

test("refuses automation a param does not offer", () => {
  const synth = addSynth();

  expect(
    state().addAutomation(synth.param("attack", "envelope"), {
      method: "setValueAtTime",
      value: 1,
      time: "0",
    }),
  ).toBeUndefined();
  expect(
    state().addAutomation(synth.param("volume"), {
      method: "exponentialRampToValueAtTime",
      value: 1,
      time: "0",
    }),
  ).toBeUndefined();
});

test("takes automation times in the shapes Tone reads", () => {
  const volume = addSynth().param("volume");
  const at = (time: string, rampTime?: string) =>
    state().addAutomation(volume, {
      method: "rampTo",
      value: -6,
      time,
      ...(rampTime === undefined ? {} : { rampTime }),
    });

  for (const time of [
    "0",
    "1.5",
    ".5",
    "+1",
    "4n",
    "4n.",
    "8t",
    "1m",
    "1:2:0",
  ]) {
    expect(at(time), time).toBeDefined();
  }
  for (const time of ["", "soon", "-1", "now", "4x", "1:"]) {
    expect(at(time), time).toBeUndefined();
  }
  expect(at("0", "later")).toBeUndefined();
});

test("queues a method call with the arguments given", () => {
  const synth = addSynth();
  const methodId = synth.method("triggerAttackRelease");

  const callId = state().callMethod(methodId, {
    note: "C4",
    duration: "8n",
    time: "",
    velocity: 0.5,
  });

  expect(state().calls).toEqual([
    {
      id: callId,
      methodId,
      args: { note: "C4", duration: "8n", velocity: 0.5 },
    },
  ]);
});

test("refuses a method call missing a required argument", () => {
  const synth = addSynth();

  expect(
    state().callMethod(synth.method("triggerAttack"), { note: "" }),
  ).toBeUndefined();
  expect(state().calls).toEqual([]);
});

test("removes a block with its values, automation and queued calls", () => {
  const synth = addSynth();
  const volume = synth.param("volume");
  state().addAutomation(volume, {
    method: "setValueAtTime",
    value: -3,
    time: "0",
  });
  state().callMethod(synth.method("triggerRelease"), {});

  state().removeBlocks([synth.id]);

  expect(state().values[volume]).toBeUndefined();
  expect(state().automations[volume]).toBeUndefined();
  expect(state().calls).toEqual([]);
});

// A runtime that only writes down which commands it was sent, so these tests
// check the store's side of the wiring without any audio.
const recordRuntime = () => {
  const sent: string[] = [];
  const record = (command: string) => (id: string) =>
    Effect.sync(() => {
      sent.push(`${command} ${id}`);
    });
  const runtime: ToneRuntime = {
    ...noopRuntime,
    addBlock: record("addBlock"),
    deleteBlock: record("deleteBlock"),
    addPatch: record("addPatch"),
    deletePatch: record("deletePatch"),
    updateParam: record("updateParam"),
    runLeafMethod: record("runLeafMethod"),
  };
  useRackStore.setState({ runtime });
  return sent;
};

test("tells the runtime about each change to the rack", () => {
  const sent = recordRuntime();

  const synth = addSynth();
  const volume = synth.param("volume");
  const destination = state().addCatalogueBlock("output", "Destination");
  const patch = state().connectJacks(`${synth.id}:out`, `${destination}:in`);
  state().setParamValue(volume, -6);
  const eventId = state().addAutomation(volume, {
    method: "setValueAtTime",
    value: -3,
    time: "0",
  });
  state().removeAutomation(volume, eventId ?? "");
  const methodId = synth.method("triggerAttackRelease");
  state().callMethod(methodId, { note: "C4", duration: "8n" });
  state().removePatches([patch ?? ""]);

  expect(sent).toEqual([
    `addBlock ${synth.id}`,
    `addBlock ${destination}`,
    `addPatch ${patch}`,
    `updateParam ${volume}`,
    `updateParam ${volume}`,
    `updateParam ${volume}`,
    `runLeafMethod ${methodId}`,
    `deletePatch ${patch}`,
  ]);
});

test("removing a block deletes its patches before the block", () => {
  const synth = addSynth();
  const destination = state().addCatalogueBlock("output", "Destination");
  const patch = state().connectJacks(`${synth.id}:out`, `${destination}:in`);
  const sent = recordRuntime();

  state().removeBlocks([synth.id]);

  expect(sent).toEqual([`deletePatch ${patch}`, `deleteBlock ${synth.id}`]);
});

test("gives the Destination only an input jack", () => {
  const destination = state().addCatalogueBlock("output", "Destination");

  expect(state().blocks[destination ?? ""]?.jackIds).toEqual([
    `${destination}:in`,
  ]);
});
