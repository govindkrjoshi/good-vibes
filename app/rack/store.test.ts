import { beforeEach, expect, test } from "vitest";
import { rackEnvelope } from "./messages";
import { onRackWork, rackStore } from "./store";
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

test("gives a leaf block code as source, so it can be sent to the sandbox", () => {
  state().addBlock("leaf");

  const block = state().blocks[children()[0]];
  if (block.type !== "leaf") throw new Error("expected a leaf block");
  expect(block.code).toContain("Leaf has no code");
  expect(structuredClone(block)).toEqual(block);
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

test("adds a template under a given id, unless it is taken", () => {
  expect(
    state().addTemplate(template("instruments", "AMSynth"), "synth-1"),
  ).toBe("synth-1");
  expect(state().blocks["synth-1"]?.name).toBe("AMSynth");
  expect(state().jacks["synth-1:out"]).toBeDefined();
  expect(state().params["synth-1:param:volume"]).toBeDefined();

  expect(
    state().addTemplate(template("output", "Destination"), "synth-1"),
  ).toBeUndefined();
  expect(
    state().addTemplate(template("output", "Destination"), ""),
  ).toBeUndefined();
  expect(state().blocks["synth-1"]?.name).toBe("AMSynth");
  expect(children()).toEqual(["synth-1"]);
});

test("starts every catalogue param at its default value", () => {
  const synth = addSynth();

  expect(state().values[synth.param("harmonicity")]).toBe(3);
  expect(state().values[synth.param("type", "oscillator")]).toBe("sine");
});

test("sets a param value, clamped into its range", () => {
  const synth = addSynth();
  const volume = synth.param("volume");

  expect(state().setParamValue(volume, -12)).toBe(true);
  expect(state().values[volume]).toBe(-12);

  expect(state().setParamValue(volume, 100)).toBe(true);
  expect(state().values[volume]).toBe(12);
});

test("refuses a value that does not fit the param", () => {
  const synth = addSynth();
  const type = synth.param("type", "oscillator");
  const volume = synth.param("volume");

  expect(state().setParamValue(type, "banjo")).toBe(false);
  expect(state().setParamValue(volume, "loud")).toBe(false);

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
  expect(state().setTransport({ bpm: 90 })).toBe(true);
  expect(state().setTransport({ bpm: 0 })).toBe(false);
  expect(state().setTransport({ bpm: Number.NaN })).toBe(false);

  expect(state().transport).toEqual({ bpm: 90 });
});

test("gives the Destination only an input jack", () => {
  const destination = state().addTemplate(template("output", "Destination"));

  expect(state().blocks[destination ?? ""]?.jackIds).toEqual([
    `${destination}:in`,
  ]);
});

// --- dispatch ---------------------------------------------------------------

const listen = () => {
  const published: number[] = [];
  const unsubscribe = rackStore.subscribe((next) => published.push(next.rev));
  return { published, unsubscribe };
};

test("dispatch says what came of a message, synchronously", () => {
  const outcome = state().dispatch(
    rackEnvelope({ _tag: "AddBlock", blockId: "b", blockType: "leaf" }),
  );

  expect(outcome).toEqual({ _tag: "Committed", id: "b" });
  expect(state().blocks.b).toBeDefined();
  expect(state().rev).toBe(initial.rev + 1);
  expect(state().workSeq).toBe(initial.workSeq + 1);
});

test("publishes each change once, and nothing for refusals or no-ops", () => {
  const { published, unsubscribe } = listen();

  state().dispatch(
    rackEnvelope({ _tag: "AddBlock", blockId: "b", blockType: "leaf" }),
  );
  const refused = state().dispatch(
    rackEnvelope({ _tag: "AddBlock", blockId: "b", blockType: "leaf" }),
  );
  const noop = state().dispatch(
    rackEnvelope({ _tag: "RemoveBlocks", blockIds: ["nothing"] }),
  );
  unsubscribe();

  expect(refused).toMatchObject({ _tag: "Refused", code: "IdTaken" });
  expect(noop).toEqual({ _tag: "Unchanged" });
  expect(published).toEqual([initial.rev + 1]);
});

test("publishes a batch as one snapshot, or nothing when it is refused", () => {
  const { published, unsubscribe } = listen();

  const outcomes = state().dispatchAll([
    rackEnvelope({ _tag: "AddBlock", blockId: "a", blockType: "leaf" }),
    rackEnvelope({ _tag: "AddBlock", blockId: "b", blockType: "leaf" }),
  ]);
  const refused = state().dispatchAll([
    rackEnvelope({ _tag: "AddBlock", blockId: "c", blockType: "leaf" }),
    rackEnvelope({ _tag: "AddBlock", blockId: "a", blockType: "leaf" }),
  ]);
  unsubscribe();

  expect(outcomes.map((outcome) => outcome._tag)).toEqual([
    "Committed",
    "Committed",
  ]);
  expect(refused.map((outcome) => outcome._tag)).toEqual([
    "RolledBack",
    "Refused",
  ]);
  expect(published).toEqual([initial.rev + 1]);
  expect(children()).toEqual(["a", "b"]);
});

test("the actions go through dispatch, stamped as the user's", () => {
  const id = state().addBlock("leaf") ?? "";

  expect(state().stamps.block[id]).toMatchObject({
    origin: "user",
    rev: initial.rev + 1,
  });
  expect(state().incarnations.block[id]).toBe(
    state().stamps.block[id]?.envelopeId,
  );
});

test("Run and Stop take a place in the order of work", () => {
  const before = state().workSeq;

  state().run();
  state().stop();

  expect(state().workSeq).toBe(before + 2);
  expect(state().rev).toBe(initial.rev);
});

test("hands each trigger to the work listeners, after the rack it came with", () => {
  const synth = addSynth();
  const heard: string[] = [];
  const unsubscribe = rackStore.subscribe((next) =>
    heard.push(`rack ${next.rev}`),
  );
  const stop = onRackWork((work) =>
    heard.push(...work.map((one) => `${one.trigger._tag} ${one.seq}`)),
  );

  state().playEvent(synth.riff);
  state().dispatchAll([
    rackEnvelope({ _tag: "SetTransport", bpm: 90 }),
    rackEnvelope({ _tag: "Run" }),
  ]);
  state().playEvent("nothing");
  unsubscribe();
  stop();

  const { rev, workSeq } = state();
  expect(heard).toEqual([
    `rack ${rev - 1}`,
    `PlayEvent ${workSeq - 1}`,
    `rack ${rev}`,
    `Run ${workSeq}`,
  ]);
});
