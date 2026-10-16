import { beforeEach, expect, test } from "vitest";
import { CATALOGUE } from "../catalogue";
import { deepFreeze } from "../testing/freeze";
import type { RackEnvelope, RackMsg } from "./messages";
import type { RackTemplate } from "./model";
import {
  initialRackMeta,
  playArgs,
  reduce,
  reduceAll,
  type Outcome,
  type RackCore,
} from "./reduce";
import { acceptValue } from "./rules";
import { initialRackState } from "./store";
import { random, randomMsg } from "../testing/rack-messages";

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const empty: RackCore = deepFreeze({ ...initialRackState, ...initialRackMeta });

let next = 0;
beforeEach(() => {
  next = 0;
});

const envelope = (
  msg: RackMsg,
  over: Partial<Omit<RackEnvelope, "msg">> = {},
): RackEnvelope =>
  deepFreeze({ id: `env-${next++}`, origin: "user", ...over, msg });

// Reduces each message in turn, freezing every state on the way in so a
// write to the input fails the test.
const play = (
  state: RackCore,
  ...msgs: RackMsg[]
): { readonly state: RackCore; readonly outcomes: Outcome[] } =>
  msgs.reduce<{ state: RackCore; outcomes: Outcome[] }>(
    (acc, msg) => {
      const { state: after, outcome } = reduce(
        deepFreeze(acc.state),
        envelope(msg),
      );
      return { state: after, outcomes: [...acc.outcomes, outcome] };
    },
    { state, outcomes: [] },
  );

const synth: RackMsg = {
  _tag: "AddTemplate",
  blockId: "synth",
  template: template("instruments", "AMSynth"),
};
const destination: RackMsg = {
  _tag: "AddTemplate",
  blockId: "out",
  template: template("output", "Destination"),
};
const volume = "synth:param:volume";

// --- Revisions and work ---------------------------------------------------

test("an edit advances the revision and the work sequence", () => {
  const { state, outcomes } = play(empty, synth);

  expect(outcomes).toEqual([{ _tag: "Committed", id: "synth" }]);
  expect(state.rev).toBe(1);
  expect(state.workSeq).toBe(1);
});

test("a trigger advances the work sequence but not the revision", () => {
  const { state: built } = play(empty, synth);
  const { state, outcomes } = play(built, { _tag: "Run" }, { _tag: "Stop" });

  expect(outcomes).toEqual([{ _tag: "Committed" }, { _tag: "Committed" }]);
  expect(state.rev).toBe(1);
  expect(state.workSeq).toBe(3);
  expect(state.blocks).toBe(built.blocks);
});

test("a refusal hands back the same state", () => {
  const { state: built } = play(empty, synth);
  const { state, outcome } = reduce(built, envelope(synth));

  expect(outcome).toMatchObject({ _tag: "Refused", code: "IdTaken" });
  expect(state).toBe(built);
});

test("a no-op hands back the same state", () => {
  const { state: built } = play(empty, synth);
  const value = built.values[volume];
  if (value === undefined) throw new Error("expected a volume");

  for (const msg of [
    { _tag: "RemoveBlocks", blockIds: ["nothing"] },
    { _tag: "RemovePatches", patchIds: ["nothing"] },
    { _tag: "RemoveEvent", eventId: "nothing" },
    { _tag: "RemoveAutomation", paramId: volume, automationId: "nothing" },
    { _tag: "SetParamValue", paramId: volume, value },
    { _tag: "SetTransport", bpm: built.transport.bpm },
  ] satisfies RackMsg[]) {
    const { state, outcome } = reduce(built, envelope(msg));
    expect(outcome, msg._tag).toEqual({ _tag: "Unchanged" });
    expect(state, msg._tag).toBe(built);
  }
});

test("refuses each kind of bad message with a code", () => {
  const { state: built } = play(empty, synth, destination);

  const cases: [RackMsg, string][] = [
    [{ _tag: "AddBlock", blockId: "synth", blockType: "leaf" }, "IdTaken"],
    [{ _tag: "AddBlock", blockId: "", blockType: "leaf" }, "IdTaken"],
    [
      { _tag: "ConnectJacks", patchId: "p", from: "out:in", to: "synth:in" },
      "InvalidConnection",
    ],
    [
      { _tag: "SetParamValue", paramId: volume, value: "loud" },
      "ValueRejected",
    ],
    [{ _tag: "SetParamValue", paramId: "nope", value: 1 }, "ValueRejected"],
    [
      {
        _tag: "AddAutomation",
        paramId: volume,
        automationId: "a",
        event: { method: "setValueAtTime", value: 1, time: "soon" },
      },
      "AutomationRejected",
    ],
    [
      {
        _tag: "AddEvent",
        eventId: "e",
        methodId: "nope",
        settings: {
          kind: "event",
          args: {},
          mute: false,
          start: "0",
          loop: false,
        },
      },
      "UnknownMethod",
    ],
    [{ _tag: "UpdateEvent", eventId: "nope", settings: {} }, "UnknownEvent"],
    [{ _tag: "SetEventSteps", eventId: "nope", steps: ["C4"] }, "UnknownEvent"],
    [
      { _tag: "SetEventSteps", eventId: "synth:event:riff", steps: [] },
      "EventRejected",
    ],
    [{ _tag: "SetTransport", bpm: 0 }, "TransportRejected"],
    [{ _tag: "PlayEvent", eventId: "nope" }, "NotPlayable"],
  ];

  for (const [msg, code] of cases) {
    const { state, outcome } = reduce(built, envelope(msg));
    expect(outcome, `${msg._tag} → ${code}`).toMatchObject({
      _tag: "Refused",
      code,
    });
    expect(state).toBe(built);
  }
});

test("hands back the patch already between two jacks, unchanged", () => {
  const connect = (patchId: string): RackMsg => ({
    _tag: "ConnectJacks",
    patchId,
    from: "synth:out",
    to: "out:in",
  });
  const { state, outcomes } = play(
    empty,
    synth,
    destination,
    connect("p1"),
    connect("p2"),
  );

  expect(outcomes.slice(2)).toEqual([
    { _tag: "Committed", id: "p1" },
    { _tag: "Unchanged", id: "p1" },
  ]);
  expect(Object.keys(state.patches)).toEqual(["p1"]);
});

// --- Stamps and incarnations ----------------------------------------------

test("stamps what a message changed with who sent it and when", () => {
  const { state: built } = play(empty, synth);
  const { state } = reduce(
    built,
    envelope(
      { _tag: "SetParamValue", paramId: volume, value: -6 },
      { id: "agent-edit", origin: "agent", turnId: "t1", chainId: "c1" },
    ),
  );

  expect(state.stamps.param[volume]).toEqual({
    rev: 2,
    envelopeId: "agent-edit",
    origin: "agent",
    turnId: "t1",
    chainId: "c1",
  });
  // Untouched entities keep their stamp from when they were added.
  expect(state.stamps.block.synth?.envelopeId).toBe("env-0");
  expect(state.stamps.block.synth?.rev).toBe(1);
});

test("stamps a block's params and events as it is added", () => {
  const { state } = play(empty, synth);

  expect(state.stamps.event["synth:event:riff"]?.envelopeId).toBe("env-0");
  expect(state.stamps.param[volume]?.envelopeId).toBe("env-0");
  // The root changed too: it holds the new child.
  expect(state.stamps.block.root?.envelopeId).toBe("env-0");
});

test("forgets stamps and incarnations of whatever a removal takes with it", () => {
  const { state } = play(
    empty,
    synth,
    destination,
    { _tag: "ConnectJacks", patchId: "p", from: "synth:out", to: "out:in" },
    { _tag: "RemoveBlocks", blockIds: ["synth"] },
  );

  for (const table of [state.stamps, state.incarnations]) {
    expect(table.block.synth).toBeUndefined();
    expect(table.patch.p).toBeUndefined();
    expect(table.event["synth:event:riff"]).toBeUndefined();
    expect(table.param[volume]).toBeUndefined();
    expect(table.block.out).toBeDefined();
  }
});

test("records the envelope that made each entity, and keeps it on edits", () => {
  const { state } = play(empty, synth, {
    _tag: "SetParamValue",
    paramId: volume,
    value: -6,
  });

  expect(state.incarnations.block.synth).toBe("env-0");
  expect(state.incarnations.param[volume]).toBe("env-0");
});

test("gives an id that is removed and added again a new incarnation", () => {
  const { state } = play(
    empty,
    synth,
    { _tag: "RemoveBlocks", blockIds: ["synth"] },
    synth,
  );

  expect(state.incarnations.block.synth).toBe("env-2");
  expect(state.incarnations.param[volume]).toBe("env-2");
});

// --- Batches --------------------------------------------------------------

test("a batch is one revision and one unit of work", () => {
  const { state, outcomes } = reduceAll(empty, [
    envelope(synth),
    envelope({ _tag: "SetParamValue", paramId: volume, value: -6 }),
    envelope(destination),
  ]);

  expect(outcomes.map((outcome) => outcome._tag)).toEqual([
    "Committed",
    "Committed",
    "Committed",
  ]);
  expect(state.rev).toBe(1);
  expect(state.workSeq).toBe(1);
  expect(state.stamps.block.synth?.rev).toBe(1);
  expect(state.stamps.param[volume]?.envelopeId).toBe("env-1");
  expect(state.values[volume]).toBe(-6);
});

test("a batch with a refusal changes nothing", () => {
  const { state, outcomes } = reduceAll(empty, [
    envelope(synth),
    envelope({ _tag: "SetParamValue", paramId: volume, value: "loud" }),
    envelope(destination),
  ]);

  expect(state).toBe(empty);
  expect(outcomes).toEqual([
    { _tag: "RolledBack" },
    expect.objectContaining({ _tag: "Refused", code: "ValueRejected" }),
    { _tag: "Skipped" },
  ]);
});

test("a batch of no-ops hands back the same state", () => {
  const { state, outcomes } = reduceAll(empty, [
    envelope({ _tag: "RemoveBlocks", blockIds: ["nothing"] }),
  ]);

  expect(state).toBe(empty);
  expect(outcomes).toEqual([{ _tag: "Unchanged" }]);
});

test("passes through anything else the state carries", () => {
  const withExtra = { ...empty, extra: () => "kept" };
  const { state } = reduce(withExtra, envelope(synth));

  expect(state.extra()).toBe("kept");
});

// --- Playing an event -----------------------------------------------------

test("plays an event with its first step as the note", () => {
  const { state } = play(empty, synth);

  expect(playArgs(state, "synth:event:riff")).toEqual({
    methodId: "synth:method:triggerAttackRelease",
    args: expect.objectContaining({ note: expect.any(String) }),
  });
  expect(playArgs(state, "nope")).toBeUndefined();
});

// --- Any sequence keeps the rack whole ------------------------------------

const problems = (state: RackCore): string[] => {
  const found: string[] = [];
  const root = state.blocks[state.rootId];
  if (root?.type !== "tree") return ["no root tree"];

  for (const id of root.children)
    if (state.blocks[id] === undefined) found.push(`missing child ${id}`);
  for (const id of root.patches)
    if (state.patches[id] === undefined) found.push(`missing patch ${id}`);
  for (const [id, patch] of Object.entries(state.patches)) {
    if (!root.patches.includes(id)) found.push(`stray patch ${id}`);
    for (const jack of [patch.from, patch.to])
      if (state.jacks[jack] === undefined)
        found.push(`patch ${id} on missing jack ${jack}`);
  }
  for (const [id, jack] of Object.entries(state.jacks))
    if (state.blocks[jack.belongToBlockId] === undefined)
      found.push(`jack ${id} on missing block`);
  for (const [id, param] of Object.entries(state.params))
    if (state.blocks[param.belongToBlockId] === undefined)
      found.push(`param ${id} on missing block`);
  for (const [id, value] of Object.entries(state.values))
    if (acceptValue(state.params[id], value) !== value)
      found.push(`value ${id} does not fit`);
  for (const id of Object.keys(state.automations))
    if (state.params[id] === undefined) found.push(`stray automation ${id}`);
  for (const [id, event] of Object.entries(state.events)) {
    if (state.methods[event.methodId] === undefined)
      found.push(`event ${id} on missing method`);
    if (!state.blocks[event.belongToBlockId]?.eventIds.includes(id))
      found.push(`event ${id} not on its block`);
  }
  for (const [kind, table] of [
    ["block", state.blocks],
    ["patch", state.patches],
    ["event", state.events],
    ["param", state.params],
  ] as const) {
    for (const id of Object.keys(state.incarnations[kind]))
      if (table[id] === undefined)
        found.push(`stray ${kind} incarnation ${id}`);
    for (const id of Object.keys(state.stamps[kind]))
      if (table[id] === undefined) found.push(`stray ${kind} stamp ${id}`);
  }
  return found;
};

test("any sequence of messages leaves the rack whole", () => {
  const committed = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1) {
    const rand = random(seed);
    let state = empty;
    let rev = 0;
    let workSeq = 0;
    for (let step = 0; step < 60; step += 1) {
      const msg = randomMsg(state, rand);
      const { state: after, outcome } = reduce(
        deepFreeze(state),
        envelope(msg),
      );
      if (outcome._tag === "Committed") {
        committed.add(msg._tag);
        workSeq += 1;
        if (after.rev !== state.rev) rev += 1;
      } else {
        expect(after, `seed ${seed} step ${step}`).toBe(state);
      }
      expect(problems(after), `seed ${seed} step ${step} ${msg._tag}`).toEqual(
        [],
      );
      expect([after.rev, after.workSeq]).toEqual([rev, workSeq]);
      state = after;
    }
  }
  // The generator has to reach every kind of change for this to mean much.
  expect([...committed].sort()).toEqual([
    "AddAutomation",
    "AddBlock",
    "AddEvent",
    "AddTemplate",
    "ConnectJacks",
    "PlayEvent",
    "RemoveBlocks",
    "RemoveEvent",
    "RemovePatches",
    "SetParamValue",
    "SetTransport",
  ]);
});

test("a retry is work for an entity that exists, and changes nothing", () => {
  const { state: built } = play(empty, synth);
  const { state, outcomes } = play(
    built,
    { _tag: "Retry", entity: "block", entityId: "synth" },
    { _tag: "Retry", entity: "patch", entityId: "nothing" },
  );

  expect(outcomes).toEqual([
    { _tag: "Committed" },
    expect.objectContaining({ _tag: "Refused", code: "UnknownEntity" }),
  ]);
  expect(state.rev).toBe(built.rev);
  expect(state.workSeq).toBe(built.workSeq + 1);
});
