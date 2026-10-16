import { expect, test, vi } from "vitest";
import {
  announced,
  rackActionsTool,
  rackActionsToolName,
  resultText,
} from "./tools";
import type { ActionResult, GoodVibesMessage, RackAction } from "./types";

const describe = { kind: "describe" } as const;
const addSynth: RackAction = {
  kind: "add_block",
  id: "synth-1",
  category: "instruments",
  entry: "AMSynth",
};
const connect: RackAction = {
  kind: "connect_blocks",
  fromBlockId: "synth-1",
  toBlockId: "speakers",
};

test("announces an action, applies it, then announces what came of it", async () => {
  const published: GoodVibesMessage[] = [];
  const apply = vi.fn(() => {
    expect(published).toEqual([
      { type: "action", id: "action-0", action: describe, status: "requested" },
    ]);
    return { ok: true, text: "Looked.", data: { blocks: [] } };
  });
  const request = announced((message) => published.push(message), apply);

  await expect(request(describe)).resolves.toEqual({
    ok: true,
    text: "Looked.",
    data: { blocks: [] },
  });
  expect(apply).toHaveBeenCalledWith(describe, undefined);
  expect(published.at(-1)).toEqual({
    type: "action",
    id: "action-0",
    action: describe,
    status: "done",
    result: { ok: true, text: "Looked.", data: { blocks: [] } },
  });
});

test("marks a refused action as failed", async () => {
  const published: GoodVibesMessage[] = [];
  const request = announced(
    (message) => published.push(message),
    () => ({ ok: false, text: "No." }),
  );

  await expect(request(describe)).resolves.toEqual({ ok: false, text: "No." });
  expect(published.at(-1)).toMatchObject({ status: "failed" });
});

test("numbers actions apart, and waits on one that takes a while", async () => {
  const published: GoodVibesMessage[] = [];
  let finish: (result: ActionResult) => void = () => undefined;
  const request = announced(
    (message) => published.push(message),
    (action) =>
      action.kind === "check_errors"
        ? new Promise<ActionResult>((resolve) => (finish = resolve))
        : { ok: true, text: "Fine." },
  );

  await request(describe);
  const checking = request({ kind: "check_errors" });
  expect(published.at(-1)).toMatchObject({
    id: "action-1",
    status: "requested",
  });
  finish({ ok: true, text: "No errors." });

  await expect(checking).resolves.toEqual({ ok: true, text: "No errors." });
  expect(published.at(-1)).toMatchObject({ id: "action-1", status: "done" });
});

test("tells the model when applying throws, instead of failing the tool", async () => {
  const request = announced(
    () => undefined,
    () => {
      throw new Error("Store is gone");
    },
  );

  await expect(request(describe)).resolves.toEqual({
    ok: false,
    text: "Store is gone",
  });
});

test("calls an action off when the reply is aborted, before or while it runs", async () => {
  const before = new AbortController();
  before.abort();
  const apply = vi.fn(() => ({ ok: true, text: "Fine." }));

  await expect(
    announced(() => undefined, apply)(describe, before.signal),
  ).resolves.toEqual({ ok: false, text: "The change was called off." });
  expect(apply).not.toHaveBeenCalled();

  const during = new AbortController();
  const running = announced(
    () => undefined,
    () =>
      new Promise<ActionResult>((_, reject) =>
        during.signal.addEventListener("abort", () =>
          reject(new Error("interrupted")),
        ),
      ),
  )({ kind: "check_errors" }, during.signal);
  during.abort();

  await expect(running).resolves.toEqual({
    ok: false,
    text: "The change was called off.",
  });
});

// Answers each action with a canned result, in order.
const answering = (...results: ActionResult[]) => {
  const queue = [...results];
  return vi.fn<(action: RackAction) => Promise<ActionResult>>(() =>
    Promise.resolve(queue.shift() ?? { ok: true, text: "Fine." }),
  );
};

test("sends each action in the list out in turn and hands the model every result", async () => {
  const request = answering(
    { ok: true, text: "Added AMSynth as synth-1.", data: { id: "synth-1" } },
    { ok: true, text: "Connected AMSynth to Destination." },
  );
  const tool = rackActionsTool(request);

  const result = await tool.execute("call", { actions: [addSynth, connect] });

  expect(tool.name).toBe(rackActionsToolName);
  expect(request.mock.calls.map(([action]) => action)).toEqual([
    addSynth,
    connect,
  ]);
  expect(result).toEqual({
    content: [
      {
        type: "text",
        text: 'Added AMSynth as synth-1.\n{"id":"synth-1"}\nConnected AMSynth to Destination.',
      },
    ],
    details: undefined,
    isError: false,
  });
});

test("stops the list at the first refusal and says what was left", async () => {
  const request = answering({ ok: false, text: "There is no fx/Reverb." });
  const tool = rackActionsTool(request);

  const result = await tool.execute("call", {
    actions: [addSynth, connect, describe],
  });

  expect(request).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    content: [
      {
        type: "text",
        text: "There is no fx/Reverb.\nStopped there; the 2 actions after it were not applied.",
      },
    ],
    details: undefined,
    isError: true,
  });
});

test("passes the reply's abort signal along", async () => {
  const request = answering();
  const controller = new AbortController();

  await rackActionsTool(request).execute(
    "call",
    { actions: [describe] },
    controller.signal,
  );

  expect(request).toHaveBeenCalledWith(describe, controller.signal);
});

test("gives the model the sentence alone when there is no detail", () => {
  expect(resultText({ ok: true, text: "Done." })).toBe("Done.");
});
