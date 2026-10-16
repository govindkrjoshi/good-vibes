import { expect, test } from "vitest";
import { initialChatState, reduceChat, type ChatEvent } from "./chat";

const fold = (...events: ChatEvent[]) =>
  events.reduce(reduceChat, initialChatState);

test("replaces a message the agent sends again, in place", () => {
  const state = fold(
    { _tag: "Prompted", turnId: "c1", text: "hi" },
    { _tag: "AgentSaid", said: { type: "message", id: "1-0", text: "He" } },
    { _tag: "AgentSaid", said: { type: "thought", id: "1-1", text: "Hmm" } },
    { _tag: "AgentSaid", said: { type: "message", id: "1-0", text: "Hello" } },
  );

  expect(state.messages.map((message) => message.text)).toEqual([
    "hi",
    "Hello",
    "Hmm",
  ]);
});

test("shows an action working, then what came of it", () => {
  const action = { kind: "check_errors" } as const;
  const state = fold(
    {
      _tag: "AgentSaid",
      said: { type: "action", id: "action-0", action, status: "requested" },
    },
    {
      _tag: "AgentSaid",
      said: {
        type: "action",
        id: "action-0",
        action,
        status: "failed",
        result: { ok: false, text: "Could not check" },
      },
    },
  );

  expect(state.messages).toEqual([
    {
      id: "agent-action-0",
      role: "assistant",
      kind: "action",
      text: "Checking for errors",
      status: "failed",
      error: "Could not check",
    },
  ]);
});

test("puts a failure on the reply it cut short, or on its own", () => {
  const onReply = fold(
    { _tag: "Prompted", turnId: "c1", text: "hi" },
    { _tag: "AgentSaid", said: { type: "message", id: "1-0", text: "He" } },
    { _tag: "ReplyFailed", turnId: "c1", error: "Rate limited" },
  );
  const alone = fold(
    { _tag: "Prompted", turnId: "c1", text: "hi" },
    { _tag: "ReplyFailed", turnId: "c1", error: "No key" },
  );

  expect(onReply.messages.at(-1)).toMatchObject({
    text: "He",
    error: "Rate limited",
  });
  expect(alone.messages.at(-1)).toMatchObject({ text: "", error: "No key" });
});

test("keeps the same state when nothing about being busy changed", () => {
  const busy = fold({ _tag: "Working", busy: true, queued: 1 });

  expect(reduceChat(busy, { _tag: "Working", busy: true, queued: 1 })).toBe(
    busy,
  );
  expect(reduceChat(busy, { _tag: "KeyNeeded", needed: false })).toBe(busy);
});
