import { Effect } from "effect";
import { beforeEach, expect, test } from "vitest";
import { noopRuntime, type ToneRuntime } from "./renderer";
import { rackStore } from "./store";
import { CATALOGUE } from "../catalogue";
import { hasOutputJack, type RackTemplate } from "./model";

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const initial = rackStore.getState();

const state = () => rackStore.getState();
const root = () => state().blocks[state().rootId];

const children = () => {
  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  return block.children;
};

beforeEach(() => {
  rackStore.setState(initial, true);
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

test("adds AMSynth with its default riff scheduled", () => {
  const id = state().addTemplate(template("instruments", "AMSynth"));
  const block = state().blocks[id ?? ""];
  const eventId = block?.eventIds[0];
  if (eventId === undefined) throw new Error("expected a default event");

  expect(block?.eventIds).toEqual([`${id}:event:riff`]);
  expect(state().events[eventId]).toMatchObject({
    kind: "sequence",
    belongToBlockId: id,
    methodId: `${id}:method:triggerAttackRelease`,
    subdivision: "8n",
  });
});

test("adds AMSynth from the instrument catalogue", () => {
  const id = state().addTemplate(template("instruments", "AMSynth"));
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
  const id = state().addTemplate(template("instruments", "AMSynth"));
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

const addSynth = () => {
  const id = state().addTemplate(template("instruments", "AMSynth"));
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
  // The riff the synth arrives playing.
  const riff = `${id}:event:riff`;
  return { id, param, method, riff };
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

test("removes a block with its values and automation", () => {
  const synth = addSynth();
  const volume = synth.param("volume");
  state().addAutomation(volume, {
    method: "setValueAtTime",
    value: -3,
    time: "0",
  });

  state().removeBlocks([synth.id]);

  expect(state().values[volume]).toBeUndefined();
  expect(state().automations[volume]).toBeUndefined();
});

const knobs = { mute: false } as const;

const sequence = {
  kind: "sequence",
  args: { duration: "8n" },
  ...knobs,
  steps: ["C4", null, "G4"],
  subdivision: "8n",
} as const;

test("adds a sequence to the block its method belongs to", () => {
  const synth = addSynth();
  const methodId = synth.method("triggerAttackRelease");

  const id = state().addEvent(methodId, sequence);
  if (id === undefined) throw new Error("expected an event");

  expect(state().events[id]).toEqual({
    ...sequence,
    id,
    methodId,
    belongToBlockId: synth.id,
  });
  expect(state().blocks[synth.id].eventIds).toEqual([synth.riff, id]);
});

test("adds a looping event, which is how Tone builds a Loop", () => {
  const methodId = addSynth().method("triggerAttackRelease");

  const settings = {
    kind: "event",
    args: { note: "C2", duration: "16n" },
    ...knobs,
    probability: 0.5,
    start: "0",
    loop: true,
    loopEnd: "4n",
  } as const;

  expect(state().addEvent(methodId, settings)).toBeDefined();
  expect(state().addEvent(methodId, { ...settings, loop: 4 })).toBeDefined();
  // A loop needs its length, and a count has to be a whole number of times.
  const { loopEnd: _, ...noEnd } = settings;
  expect(state().addEvent(methodId, noEnd)).toBeUndefined();
  expect(
    state().addEvent(methodId, { ...settings, loop: 1.5 }),
  ).toBeUndefined();
  // With no value to fire, the note has to be fixed.
  expect(
    state().addEvent(methodId, { ...settings, args: { duration: "16n" } }),
  ).toBeUndefined();
});

test("adds a pattern", () => {
  const methodId = addSynth().method("triggerAttackRelease");

  const id = state().addEvent(methodId, {
    kind: "pattern",
    args: { duration: "16n" },
    ...knobs,
    values: ["C4", "E4", "G4"],
    pattern: "upDown",
    interval: "16n",
  });

  expect(id).toBeDefined();
  expect(
    state().addEvent(methodId, {
      kind: "pattern",
      args: { duration: "16n" },
      ...knobs,
      values: [],
      pattern: "up",
      interval: "16n",
    }),
  ).toBeUndefined();
});

test("adds a part", () => {
  const methodId = addSynth().method("triggerAttack");

  const id = state().addEvent(methodId, {
    kind: "part",
    args: {},
    ...knobs,
    steps: [
      { time: "0", value: "C4" },
      { time: "0:1", value: null },
    ],
    loopEnd: "1m",
  });

  expect(id).toBeDefined();
});

test("refuses an event on a method that takes no time", () => {
  const synth = addSynth();
  const block = state().blocks[synth.id];
  const methodId = "untimed";
  rackStore.setState({
    methods: {
      ...state().methods,
      [methodId]: {
        id: methodId,
        name: "Untimed",
        belongToBlockId: synth.id,
        method: "triggerAttack",
        args: [{ name: "note", kind: "note" }],
      },
    },
    blocks: {
      ...state().blocks,
      [synth.id]: { ...block, methodIds: [...block.methodIds, methodId] },
    },
  });

  expect(state().addEvent(methodId, { ...sequence, args: {} })).toBeUndefined();
  expect(Object.keys(state().events)).toEqual([synth.riff]);
});

test("refuses an event with a time Tone cannot read", () => {
  const synth = addSynth();
  const methodId = synth.method("triggerAttackRelease");

  expect(
    state().addEvent(methodId, { ...sequence, subdivision: "soon" }),
  ).toBeUndefined();
  expect(
    state().addEvent(methodId, { ...sequence, humanize: "a bit" }),
  ).toBeUndefined();
  expect(
    state().addEvent(methodId, {
      kind: "part",
      args: { duration: "8n" },
      ...knobs,
      steps: [{ time: "later", value: "C4" }],
    }),
  ).toBeUndefined();
  expect(Object.keys(state().events)).toEqual([synth.riff]);
});

test("sets a sequence's steps", () => {
  const id = state().addEvent(
    addSynth().method("triggerAttackRelease"),
    sequence,
  );
  if (id === undefined) throw new Error("expected an event");

  state().setEventSteps(id, ["A3", "B3"]);

  expect(state().events[id]).toMatchObject({ steps: ["A3", "B3"] });
});

test("updates an event only to settings it would accept", () => {
  const id = state().addEvent(
    addSynth().method("triggerAttackRelease"),
    sequence,
  );
  if (id === undefined) throw new Error("expected an event");

  state().updateEvent(id, { subdivision: "4n", mute: true });
  state().updateEvent(id, { subdivision: "never" });

  expect(state().events[id]).toMatchObject({ subdivision: "4n", mute: true });
});

test("removes an event from the rack and its block", () => {
  const synth = addSynth();
  const id = state().addEvent(synth.method("triggerAttackRelease"), sequence);
  if (id === undefined) throw new Error("expected an event");

  state().removeEvent(id);

  expect(Object.keys(state().events)).toEqual([synth.riff]);
  expect(state().blocks[synth.id].eventIds).toEqual([synth.riff]);
});

test("removes a block with its events", () => {
  const synth = addSynth();
  const other = addSynth();
  state().addEvent(synth.method("triggerAttackRelease"), sequence);
  const kept = state().addEvent(other.method("triggerAttackRelease"), sequence);

  state().removeBlocks([synth.id]);

  expect(Object.keys(state().events)).toEqual([other.riff, kept]);
  expect(state().blocks[other.id].eventIds).toEqual([other.riff, kept]);
});

test("sets the tempo only to a positive number", () => {
  state().setTransport({ bpm: 90 });
  state().setTransport({ bpm: 0 });
  state().setTransport({ bpm: Number.NaN });

  expect(state().transport).toEqual({ bpm: 90 });
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
    updateEvent: record("updateEvent"),
    updateEventLive: record("updateEventLive"),
    deleteEvent: record("deleteEvent"),
    updateTransport: record("updateTransport")("bpm"),
    stop: record("stop")("transport"),
  };
  rackStore.setState({ runtime });
  return sent;
};

test("tells the runtime about each change to the rack", async () => {
  const sent = recordRuntime();

  const synth = addSynth();
  const volume = synth.param("volume");
  const destination = state().addTemplate(template("output", "Destination"));
  const patch = state().connectJacks(`${synth.id}:out`, `${destination}:in`);
  state().setParamValue(volume, -6);
  const eventId = state().addAutomation(volume, {
    method: "setValueAtTime",
    value: -3,
    time: "0",
  });
  state().removeAutomation(volume, eventId ?? "");
  const methodId = synth.method("triggerAttackRelease");
  const event = state().addEvent(methodId, sequence);
  state().playEvent(event ?? "");
  state().removePatches([patch ?? ""]);
  state().setEventSteps(event ?? "", ["E4"]);
  state().updateEvent(event ?? "", { subdivision: "4n" });
  state().removeEvent(event ?? "");
  state().setTransport({ bpm: 90 });
  state().stop();
  // Stop is queued behind Run, so it lands a tick later.
  await new Promise((resolve) => setTimeout(resolve));

  expect(sent).toEqual([
    `addBlock ${synth.id}`,
    `addBlock ${destination}`,
    `addPatch ${patch}`,
    `updateParam ${volume}`,
    `updateParam ${volume}`,
    `updateParam ${volume}`,
    `updateEvent ${event}`,
    `runLeafMethod ${methodId}`,
    `deletePatch ${patch}`,
    `updateEventLive ${event}`,
    `updateEvent ${event}`,
    `deleteEvent ${event}`,
    "updateTransport bpm",
    "stop transport",
  ]);
});

test("plays an event now with its method and first step as the note", () => {
  const synth = addSynth();
  const methodId = synth.method("triggerAttackRelease");
  const event = state().addEvent(methodId, {
    ...sequence,
    steps: [null, "E4", "G4"],
  });
  const sent: unknown[] = [];
  rackStore.setState({
    runtime: {
      ...noopRuntime,
      runLeafMethod: (id, args) =>
        Effect.sync(() => {
          sent.push([id, args]);
        }),
    },
  });

  state().playEvent(event ?? "");

  expect(sent).toEqual([[methodId, { duration: "8n", note: "E4" }]]);
});

test("removing a block deletes its patches and events before the block", () => {
  const synth = addSynth();
  const destination = state().addTemplate(template("output", "Destination"));
  const patch = state().connectJacks(`${synth.id}:out`, `${destination}:in`);
  const event = state().addEvent(
    synth.method("triggerAttackRelease"),
    sequence,
  );
  const sent = recordRuntime();

  state().removeBlocks([synth.id]);

  expect(sent).toEqual([
    `deletePatch ${patch}`,
    `deleteEvent ${synth.riff}`,
    `deleteEvent ${event}`,
    `deleteBlock ${synth.id}`,
  ]);
});

test("gives the Destination only an input jack", () => {
  const destination = state().addTemplate(template("output", "Destination"));

  expect(state().blocks[destination ?? ""]?.jackIds).toEqual([
    `${destination}:in`,
  ]);
});
