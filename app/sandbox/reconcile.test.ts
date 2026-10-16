import { expect, test } from "vitest";
import { CATALOGUE } from "../catalogue";
import type { RackMsg } from "../rack/messages";
import type { RackTemplate } from "../rack/model";
import { initialRackMeta, reduce, type RackCore } from "../rack/reduce";
import { initialRackState } from "../rack/store";
import { deepFreeze } from "../testing/freeze";
import {
  commandsFor,
  emptySnapshot,
  type ErrorKind,
  type Planned,
} from "./reconcile";

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const empty: RackCore = deepFreeze({ ...initialRackState, ...initialRackMeta });

let next = 0;
const play = (state: RackCore, ...msgs: RackMsg[]): RackCore =>
  msgs.reduce(
    (acc, msg) =>
      deepFreeze(
        reduce(acc, { id: `env-${next++}`, origin: "user", msg }).state,
      ),
    state,
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
const connect: RackMsg = {
  _tag: "ConnectJacks",
  patchId: "p",
  from: "synth:out",
  to: "out:in",
};
const volume = "synth:param:volume";
const riff = "synth:event:riff";

const names = (planned: readonly Planned[]) =>
  planned.map(({ command }) => {
    const { name, ...rest } = command;
    const id = Object.values(rest)[0];
    return typeof id === "string" ? `${name} ${id}` : name;
  });

const failing =
  (...keys: `${ErrorKind} ${string}`[]) =>
  (kind: ErrorKind, id: string) =>
    keys.includes(`${kind} ${id}`);

const rack = () => play(empty, synth, destination, connect);

test("builds a rack from nothing, leaving a leaf's events to the leaf", () => {
  expect(names(commandsFor(emptySnapshot, rack()))).toEqual([
    "addBlock synth",
    "addBlock out",
    "addPatch p",
  ]);
});

test("sends nothing when nothing changed", () => {
  const state = rack();

  expect(commandsFor(state, state)).toEqual([]);
});

test("sends nothing for a block added and removed in between", () => {
  const before = rack();
  const after = play(
    before,
    { _tag: "AddBlock", blockId: "brief", blockType: "leaf" },
    { _tag: "RemoveBlocks", blockIds: ["brief"] },
  );

  expect(commandsFor(before, after)).toEqual([]);
});

test("takes patches and events away before the block they use", () => {
  const before = rack();
  const after = play(before, { _tag: "RemoveBlocks", blockIds: ["synth"] });

  expect(names(commandsFor(before, after))).toEqual([
    "deletePatch p",
    `deleteEvent ${riff}`,
    "deleteBlock synth",
  ]);
});

test("updates a changed param, once, at its latest value", () => {
  const before = rack();
  const after = play(
    before,
    { _tag: "SetParamValue", paramId: volume, value: -6 },
    { _tag: "SetParamValue", paramId: volume, value: -3 },
  );

  expect(names(commandsFor(before, after))).toEqual([`updateParam ${volume}`]);
  expect(after.values[volume]).toBe(-3);
});

test("rebuilds a block that failed to build when one of its params changes, and brings its patches back", () => {
  const before = rack();
  const after = play(before, {
    _tag: "SetParamValue",
    paramId: volume,
    value: -6,
  });

  const planned = commandsFor(before, after, failing("build synth"));

  expect(names(planned)).toEqual(["addBlock synth", "addPatch p"]);
  // The patch is back because of the param change that rebuilt its end.
  expect(planned[1]?.cause).toEqual(planned[0]?.cause);
  expect(planned[0]?.cause).toMatchObject({ entity: "param", id: volume });
});

test("leaves a failed block alone while nothing about it changes", () => {
  const before = rack();
  const after = play(before, { _tag: "SetTransport", bpm: 90 });

  expect(names(commandsFor(before, after, failing("build synth")))).toEqual([
    "updateTransport",
  ]);
});

test("rebuilds what a retry names, even unchanged", () => {
  const state = rack();

  expect(
    names(
      commandsFor(state, state, () => false, [
        { entity: "block", id: "synth" },
      ]),
    ),
  ).toEqual(["addBlock synth", "addPatch p"]);
  expect(
    names(
      commandsFor(state, state, () => false, [{ entity: "patch", id: "p" }]),
    ),
  ).toEqual(["addPatch p"]);
  expect(
    names(
      commandsFor(state, state, () => false, [{ entity: "event", id: riff }]),
    ),
  ).toEqual([`updateEvent ${riff}`]);
});

test("replaces an id that was removed and added again, even if it looks the same", () => {
  const before = rack();
  const after = play(
    before,
    { _tag: "RemoveBlocks", blockIds: ["out"] },
    destination,
  );

  expect(names(commandsFor(before, after))).toEqual([
    "deletePatch p",
    "deleteBlock out",
    "addBlock out",
  ]);
});

test("updates a sequence live when only its steps changed", () => {
  const before = rack();
  const steps = play(before, {
    _tag: "SetEventSteps",
    eventId: riff,
    steps: ["A3"],
  });
  const knobs = play(before, {
    _tag: "UpdateEvent",
    eventId: riff,
    settings: { mute: true },
  });

  expect(names(commandsFor(before, steps))).toEqual([
    `updateEventLive ${riff}`,
  ]);
  expect(names(commandsFor(before, knobs))).toEqual([`updateEvent ${riff}`]);
  // A failed schedule is built again rather than patched.
  expect(
    names(commandsFor(before, steps, failing(`schedule ${riff}`))),
  ).toEqual([`updateEvent ${riff}`]);
});

test("schedules an event added to a block that is already built", () => {
  const before = rack();
  const after = play(before, {
    _tag: "AddEvent",
    eventId: "e",
    methodId: "synth:method:triggerAttackRelease",
    settings: {
      kind: "sequence",
      args: { duration: "8n" },
      mute: false,
      steps: ["C4"],
      subdivision: "4n",
    },
  });

  expect(names(commandsFor(before, after))).toEqual(["updateEvent e"]);
});

test("names what each command is for, as the entity's incarnation", () => {
  const state = rack();
  const planned = commandsFor(emptySnapshot, state);

  expect(planned.map(({ target, errorKind }) => [target, errorKind])).toEqual([
    [
      {
        entity: "block",
        id: "synth",
        incarnation: state.incarnations.block.synth,
      },
      "build",
    ],
    [
      { entity: "block", id: "out", incarnation: state.incarnations.block.out },
      "build",
    ],
    [
      { entity: "patch", id: "p", incarnation: state.incarnations.patch.p },
      "connect",
    ],
  ]);
  expect(state.incarnations.block.synth).toBeDefined();
});

test("names the change behind each command", () => {
  const before = rack();
  const after = play(
    before,
    { _tag: "SetParamValue", paramId: volume, value: -6 },
    { _tag: "RemovePatches", patchIds: ["p"] },
  );

  expect(
    commandsFor(before, after).map(({ command, cause }) => [
      command.name,
      cause?.envelopeId,
    ]),
  ).toEqual([
    // The root held the patch, and changed when it went.
    ["deletePatch", after.stamps.block.root?.envelopeId],
    ["updateParam", after.stamps.param[volume]?.envelopeId],
  ]);
});
