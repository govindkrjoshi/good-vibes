// @vitest-environment happy-dom

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, expect, test } from "vitest";
import {
  clearLegacyChat,
  legacyChatStorageKey,
  loadLegacyChat,
  settledTranscript,
} from "./history";

afterEach(() => {
  localStorage.clear();
});

const user = (text: string): AgentMessage => ({
  role: "user",
  content: text,
  timestamp: 1,
});

test("reads the conversation kept before there were several", () => {
  expect(loadLegacyChat()).toBeUndefined();
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
  localStorage.setItem(legacyChatStorageKey, JSON.stringify(chat));

  expect(loadLegacyChat()).toEqual(chat);
  clearLegacyChat();
  expect(localStorage.getItem(legacyChatStorageKey)).toBeNull();
});

test("ignores what it cannot read", () => {
  localStorage.setItem(legacyChatStorageKey, "nope");
  expect(loadLegacyChat()).toBeUndefined();

  localStorage.setItem(legacyChatStorageKey, JSON.stringify({ messages: "x" }));
  expect(loadLegacyChat()).toBeUndefined();

  localStorage.setItem(
    legacyChatStorageKey,
    JSON.stringify({
      messages: [{ id: "a", role: "ghost", kind: "message", text: "" }],
      transcript: [],
    }),
  );
  expect(loadLegacyChat()).toBeUndefined();
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
