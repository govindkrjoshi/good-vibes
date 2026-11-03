// @vitest-environment happy-dom

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, expect, test } from "vitest";
import {
  chatStorageKey,
  clearChat,
  loadChat,
  settledTranscript,
  storeChat,
} from "./history";

afterEach(() => {
  localStorage.clear();
});

const user = (text: string): AgentMessage => ({
  role: "user",
  content: text,
  timestamp: 1,
});

test("round-trips a conversation through local storage", () => {
  expect(loadChat()).toBeUndefined();
  const chat = {
    messages: [
      {
        id: "user-0",
        role: "user" as const,
        kind: "message" as const,
        text: "hi",
      },
    ],
    transcript: [user("hi"), fauxAssistantMessage("Hello.")],
  };

  storeChat(chat);

  expect(loadChat()).toEqual(chat);
  clearChat();
  expect(localStorage.getItem(chatStorageKey)).toBeNull();
});

test("ignores what it cannot read", () => {
  localStorage.setItem(chatStorageKey, "nope");
  expect(loadChat()).toBeUndefined();

  localStorage.setItem(chatStorageKey, JSON.stringify({ messages: "x" }));
  expect(loadChat()).toBeUndefined();

  localStorage.setItem(
    chatStorageKey,
    JSON.stringify({
      messages: [{ id: "a", role: "ghost", kind: "message", text: "" }],
      transcript: [],
    }),
  );
  expect(loadChat()).toBeUndefined();
});

test("settles a transcript on a finished reply or tool results", () => {
  const done = fauxAssistantMessage("Hello.");
  const system: AgentMessage = {
    role: "system",
    content: "Be nice.",
    timestamp: 0,
  };
  expect(settledTranscript([system, user("hi"), done])).toEqual([
    user("hi"),
    done,
  ]);

  expect(settledTranscript([user("hi"), done, user("more")])).toEqual([
    user("hi"),
    done,
  ]);

  const cut = fauxAssistantMessage("Hel", { stopReason: "aborted" });
  const failed = fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: "401",
  });
  expect(settledTranscript([user("hi"), cut])).toEqual([]);
  expect(settledTranscript([user("hi"), done, user("more"), failed])).toEqual([
    user("hi"),
    done,
  ]);

  const results: AgentMessage = {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "read_rack",
    content: [{ type: "text", text: "Nothing yet." }],
    isError: false,
    timestamp: 2,
  };
  const calling = fauxAssistantMessage("", { stopReason: "toolUse" });
  expect(settledTranscript([user("hi"), calling, results])).toEqual([
    user("hi"),
    calling,
    results,
  ]);
  expect(settledTranscript([user("hi"), calling])).toEqual([]);
});
