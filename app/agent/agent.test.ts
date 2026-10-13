import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { expect, test } from "vitest";
import { goodVibesModel, messagesOf } from "./agent";

test("uses a model the browser can reach through OpenRouter's CORS", () => {
  expect(goodVibesModel()).toMatchObject({
    provider: "openrouter",
    api: "openai-completions",
  });
});

test("turns a reply's parts into thoughts and messages", () => {
  const reply = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "They said hello." },
      { type: "toolCall", id: "call", name: "noop", arguments: {} },
      { type: "text", text: "Hi there" },
    ],
  } as AgentMessage;

  expect(messagesOf(reply, 3)).toEqual([
    { type: "thought", id: "3-0", text: "They said hello." },
    { type: "message", id: "3-2", text: "Hi there" },
  ]);
});

test("has nothing to say for what the user sent", () => {
  expect(
    messagesOf({ role: "user", content: "hello" } as AgentMessage, 1),
  ).toEqual([]);
});
