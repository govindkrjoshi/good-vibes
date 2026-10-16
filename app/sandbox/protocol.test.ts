import { expect, test } from "vitest";
import { initialRackState } from "../rack/store";
import {
  frameReady,
  isFrameReady,
  isHostHello,
  isBatch,
  isReply,
  rackChanges,
} from "./protocol";

const batch = {
  v: 2,
  type: "batch",
  gen: 1,
  batchId: 1,
  changes: { ...initialRackState },
  commands: [{ cmdId: 1, command: { name: "addBlock", blockId: "synth" } }],
};
const withCommand = (command: unknown) => ({
  ...batch,
  commands: [{ cmdId: 1, command }],
});

test("accepts a batch of rack changes and known commands", () => {
  expect(isBatch(batch)).toBe(true);
  expect(isBatch({ ...batch, changes: {}, commands: [] })).toBe(true);
  expect(
    isBatch(
      withCommand({
        name: "runLeafMethod",
        methodId: "m",
        args: { note: "C4" },
      }),
    ),
  ).toBe(true);
});

test.each([
  ["an unknown command", withCommand({ name: "eval", code: "1" })],
  ["a command missing its id", withCommand({ name: "addBlock" })],
  ["no generation", { ...batch, gen: undefined }],
  [
    "a command with no number",
    { ...batch, commands: [{ command: { name: "stop" } }] },
  ],
  [
    "leaf code that is not source",
    {
      ...batch,
      changes: {
        blocks: {
          leaf: {
            id: "leaf",
            name: "Leaf",
            type: "leaf",
            isRoot: false,
            jackIds: [],
            paramIds: {},
            methodIds: [],
            eventIds: [],
            code: { toString: "alert(1)" },
          },
        },
      },
    },
  ],
  ["a transport that is not one", { ...batch, changes: { transport: 1 } }],
  [
    "an old-style request",
    { type: "request", id: 1, changes: {}, command: { name: "stop" } },
  ],
  ["something else entirely", "render"],
])("refuses a batch with %s", (_, message) => {
  expect(isBatch(message)).toBe(false);
});

test("accepts only batch results, playback reports and audio states from the frame", () => {
  const result = {
    v: 2,
    type: "batchResult",
    gen: 1,
    batchId: 1,
    results: [
      {
        cmdId: 1,
        failure: { code: "PatchFailed", message: "no" },
        entities: [
          {
            entity: "patch",
            id: "p",
            failure: { code: "PatchFailed", message: "no" },
          },
        ],
      },
    ],
  };
  expect(isReply(result)).toBe(true);
  expect(
    isReply({
      v: 2,
      type: "playback",
      gen: 1,
      eventId: "e",
      scheduleCmdId: 2,
      message: "x",
    }),
  ).toBe(true);
  expect(isReply({ type: "audio", state: "suspended" })).toBe(true);

  expect(isReply({ type: "audio", state: "loud" })).toBe(false);
  expect(
    isReply({
      ...result,
      results: [
        { cmdId: 1, failure: { code: "Boom", message: "no" }, entities: [] },
      ],
    }),
  ).toBe(false);
  expect(isReply({ type: "result", id: 3 })).toBe(false);
  expect(isReply({ type: "navigate", to: "https://example.com" })).toBe(false);
});

test("tells the handshake messages apart", () => {
  expect(isFrameReady(frameReady("abc"))).toBe(true);
  expect(isFrameReady({ ...frameReady("abc"), channel: "other" })).toBe(false);
  expect(isHostHello({ channel: "good-vibes:sandbox", type: "ping" })).toBe(
    true,
  );
  expect(isHostHello({ channel: "good-vibes:sandbox", type: "ready" })).toBe(
    false,
  );
});

test("sends the whole rack first, then only the parts that changed", () => {
  const next = { ...initialRackState, transport: { bpm: 90 } };

  expect(Object.keys(rackChanges(undefined, initialRackState))).toEqual(
    Object.keys(initialRackState),
  );
  expect(rackChanges(initialRackState, next)).toEqual({
    transport: { bpm: 90 },
  });
  expect(rackChanges(next, next)).toEqual({});
});

test("leaves out whatever is not the rack's data", () => {
  const store = { ...initialRackState, run: () => undefined };

  expect(Object.keys(rackChanges(undefined, store))).toEqual(
    Object.keys(initialRackState),
  );
});
