import { expect, test, vi } from "vitest";
import {
  actionRequests,
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

test("sends an action out, waits to be settled, then sends the outcome", async () => {
  const published: GoodVibesMessage[] = [];
  const { request, settle } = actionRequests((message) =>
    published.push(message),
  );

  const pending = request(describe);
  expect(published).toEqual([
    { type: "action", id: "action-0", action: describe, status: "requested" },
  ]);

  settle("action-0", { ok: true, text: "Looked.", data: { blocks: [] } });

  await expect(pending).resolves.toEqual({
    ok: true,
    text: "Looked.",
    data: { blocks: [] },
  });
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
  const { request, settle } = actionRequests((message) =>
    published.push(message),
  );

  const pending = request(describe);
  settle("action-0", { ok: false, text: "No." });

  await expect(pending).resolves.toEqual({ ok: false, text: "No." });
  expect(published.at(-1)).toMatchObject({ status: "failed" });
});

test("numbers requests apart and settles each by its own id", async () => {
  const { request, settle } = actionRequests(() => undefined);

  const first = request(describe);
  const second = request({ kind: "set_transport", bpm: 90 });
  settle("action-1", { ok: true, text: "Second." });
  settle("action-0", { ok: true, text: "First." });

  await expect(first).resolves.toMatchObject({ text: "First." });
  await expect(second).resolves.toMatchObject({ text: "Second." });
});

test("settles only once", async () => {
  const published: GoodVibesMessage[] = [];
  const { request, settle } = actionRequests((message) =>
    published.push(message),
  );

  const pending = request(describe);
  settle("action-0", { ok: true, text: "Once." });
  settle("action-0", { ok: false, text: "Twice." });

  await expect(pending).resolves.toMatchObject({ text: "Once." });
  expect(published).toHaveLength(2);
});

test("fails a request nobody answers", async () => {
  vi.useFakeTimers();
  try {
    const { request } = actionRequests(() => undefined, 50);
    const pending = request(describe);
    vi.advanceTimersByTime(50);

    await expect(pending).resolves.toEqual({
      ok: false,
      text: "Nothing applied the change.",
    });
  } finally {
    vi.useRealTimers();
  }
});

test("calls a request off when the reply is aborted", async () => {
  const { request } = actionRequests(() => undefined);
  const controller = new AbortController();

  const pending = request(describe, controller.signal);
  controller.abort();

  await expect(pending).resolves.toEqual({
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
