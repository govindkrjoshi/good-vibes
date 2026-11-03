import { expect, test } from "vitest";
import type { Method, Param } from "./model";
import {
  automationProblems,
  eventProblems,
  stepsProblems,
  transportProblems,
  valueProblems,
} from "./validate";

const number: Param = {
  id: "R:param:volume",
  name: "Volume",
  belongToRackId: "R",
  path: ["volume"],
  kind: "number",
  defaultValue: 0,
  min: -60,
  max: 12,
  automation: { methods: ["setValueAtTime", "rampTo"] },
};

const select: Param = {
  id: "R:param:type",
  name: "Type",
  belongToRackId: "R",
  path: ["type"],
  kind: "select",
  defaultValue: "sine",
  options: [{ value: "sine" }, { value: "square" }],
};

const flag: Param = {
  id: "R:param:mute",
  name: "Mute",
  belongToRackId: "R",
  path: ["mute"],
  kind: "boolean",
  defaultValue: false,
};

const trigger: Method = {
  id: "R:method:triggerAttackRelease",
  name: "Trigger Attack Release",
  belongToBlockId: "R",
  method: "triggerAttackRelease",
  args: [
    { name: "note", kind: "note" },
    { name: "duration", kind: "time" },
    { name: "time", kind: "time", optional: true },
    { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
  ],
};

const release: Method = {
  id: "R:method:triggerRelease",
  name: "Trigger Release",
  belongToBlockId: "R",
  method: "triggerRelease",
  args: [{ name: "time", kind: "time", optional: true }],
};

const start: Method = {
  id: "R:method:start",
  name: "Start",
  belongToBlockId: "R",
  method: "start",
  args: [],
};

test("a value has to fit its param", () => {
  expect(valueProblems(number, -6)).toEqual([]);
  expect(valueProblems(number, "loud")).toEqual([
    'Volume takes a number, not "loud"',
  ]);
  expect(valueProblems(number, 20)).toEqual([
    "Volume must be at least -60 and at most 12, not 20",
  ]);
  expect(valueProblems(number, Number.NaN)).toHaveLength(1);
  expect(valueProblems(select, "square")).toEqual([]);
  expect(valueProblems(select, "saw")).toEqual([
    'Type must be one of "sine", "square", not "saw"',
  ]);
  expect(valueProblems(flag, true)).toEqual([]);
  expect(valueProblems(flag, 1)).toEqual(["Mute takes true or false, not 1"]);
});

test("automation needs an automatable param, a known method and times", () => {
  expect(
    automationProblems(number, {
      method: "rampTo",
      value: -6,
      time: "1m",
      rampTime: "4n",
    }),
  ).toEqual([]);
  expect(
    automationProblems(number, { method: "rampTo", value: -6, time: "1m" }),
  ).toEqual(["rampTo needs a rampTime to ramp over"]);
  expect(
    automationProblems(number, {
      method: "exponentialRampToValueAtTime",
      value: 99,
      time: "soon",
    }),
  ).toEqual([
    "Volume can be automated with setValueAtTime, rampTo, not exponentialRampToValueAtTime",
    "automation Volume must be at least -60 and at most 12, not 99",
    'time "soon" is not a time: seconds (0.5), a note length (4n, 8t, 1m, 4n.), or bars:beats:sixteenths (1:2:0)',
  ]);
  expect(
    automationProblems(select, {
      method: "setValueAtTime",
      value: 1,
      time: "0",
    }),
  ).toEqual(["Type can't be automated"]);
});

test("an event needs a method it can be scheduled on", () => {
  const sequence = {
    kind: "sequence" as const,
    steps: ["C4", null],
    subdivision: "8n",
    args: { duration: "16n" },
    mute: false,
  };
  expect(eventProblems(trigger, sequence)).toEqual([]);
  expect(eventProblems(start, sequence)).toEqual([
    "Start has no time argument, so it can't be scheduled",
  ]);
  expect(eventProblems(release, { ...sequence, args: {} })).toEqual([
    'Trigger Release has no note argument, so it can only be a loop (kind "event")',
  ]);
  expect(
    eventProblems(release, {
      kind: "event",
      start: "0",
      loop: true,
      loopEnd: "1m",
      args: {},
      mute: false,
    }),
  ).toEqual([]);
});

test("an event's fixed args have to be the method's, and fit", () => {
  const sequence = {
    kind: "sequence" as const,
    steps: ["C4"],
    subdivision: "8n",
    mute: false,
  };
  expect(eventProblems(trigger, { ...sequence, args: {} })).toEqual([
    "args needs duration (time)",
  ]);
  expect(
    eventProblems(trigger, {
      ...sequence,
      args: { duration: "long", velocity: "hard", accent: true },
    }),
  ).toEqual([
    "args: duration takes a time: seconds (0.5), a note length (4n, 8t, 1m, 4n.), or bars:beats:sixteenths (1:2:0)",
    "args: velocity takes a number",
    "Trigger Attack Release has no argument accent",
  ]);
});

test("each kind of event checks its own settings", () => {
  const args = { duration: "8n" };
  expect(
    eventProblems(trigger, {
      kind: "sequence",
      steps: [],
      subdivision: "fast",
      args,
      mute: false,
      probability: 2,
      humanize: "lots",
      playbackRate: 0,
    }),
  ).toEqual([
    "probability must be between 0 and 1",
    "humanize must be true, false or a time: seconds (0.5), a note length (4n, 8t, 1m, 4n.), or bars:beats:sixteenths (1:2:0)",
    "playbackRate must be greater than 0",
    "a sequence needs steps",
    'subdivision "fast" is not a time: seconds (0.5), a note length (4n, 8t, 1m, 4n.), or bars:beats:sixteenths (1:2:0)',
  ]);
  expect(
    eventProblems(trigger, {
      kind: "pattern",
      values: [],
      pattern: "sideways" as "up",
      interval: "4n",
      args,
      mute: false,
    }),
  ).toEqual([
    "a pattern needs values",
    "pattern must be one of up, down, upDown, downUp, alternateUp, alternateDown, random, randomOnce, randomWalk",
  ]);
  expect(
    eventProblems(trigger, {
      kind: "part",
      steps: [
        { time: "0:0:0", value: "C4" },
        { time: "then", value: "E4" },
      ],
      loopEnd: "1m",
      args,
      mute: false,
    }),
  ).toEqual(['step time "then" is not a time']);
  expect(
    eventProblems(trigger, {
      kind: "event",
      value: "C4",
      start: "0",
      loop: 1.5,
      loopEnd: "never",
      args,
      mute: false,
    }),
  ).toEqual([
    "loop must be true, false or a whole number of times",
    'loopEnd "never" is not a time',
  ]);
});

test("steps and tempo have their own checks", () => {
  expect(stepsProblems([])).toHaveLength(1);
  expect(stepsProblems([null])).toEqual([]);
  expect(transportProblems({ bpm: 0 })).toHaveLength(1);
  expect(transportProblems({ bpm: Number.NaN })).toHaveLength(1);
  expect(transportProblems({ bpm: 120 })).toEqual([]);
  expect(transportProblems({ playing: true })).toEqual([]);
});
