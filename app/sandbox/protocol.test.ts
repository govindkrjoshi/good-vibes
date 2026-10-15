import { expect, test } from "vitest";
import { initialRackState } from "../rack/store";
import {
  frameReady,
  isFrameReady,
  isHostHello,
  isReply,
  isRequest,
  rackChanges,
} from "./protocol";

const request = {
  type: "request",
  id: 1,
  changes: { ...initialRackState },
  command: { name: "addBlock", blockId: "synth" },
};

test("accepts a request with rack changes and a known command", () => {
  expect(isRequest(request)).toBe(true);
  expect(isRequest({ ...request, changes: {} })).toBe(true);
  expect(
    isRequest({
      ...request,
      command: { name: "runLeafMethod", methodId: "m", args: { note: "C4" } },
    }),
  ).toBe(true);
});

test.each([
  ["an unknown command", { ...request, command: { name: "eval", code: "1" } }],
  ["a command missing its id", { ...request, command: { name: "addBlock" } }],
  ["no id", { ...request, id: "1" }],
  [
    "leaf code that is not source",
    {
      ...request,
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
  ["a transport that is not one", { ...request, changes: { transport: 1 } }],
  ["something else entirely", "render"],
])("refuses a request with %s", (_, message) => {
  expect(isRequest(message)).toBe(false);
});

test("accepts only results and audio states from the frame", () => {
  expect(isReply({ type: "result", id: 3 })).toBe(true);
  expect(
    isReply({
      type: "result",
      id: 3,
      error: { _tag: "PatchError", message: "no" },
    }),
  ).toBe(true);
  expect(isReply({ type: "audio", state: "suspended" })).toBe(true);

  expect(isReply({ type: "audio", state: "loud" })).toBe(false);
  expect(isReply({ type: "result", id: 3, error: { _tag: "Boom" } })).toBe(
    false,
  );
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
