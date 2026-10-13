// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatMessage } from "../hooks/useGoodVibesAgent";
import { ChatPanel } from "./chat-panel";

const agent = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  busy: false,
  prompt: vi.fn(),
  abort: vi.fn(),
  changeKey: vi.fn(),
}));

vi.mock("../hooks/useGoodVibesAgent", () => ({
  useGoodVibesAgent: () => agent,
  useAgentGreeting: () => {},
}));

let container: HTMLDivElement;
let root: Root;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<ChatPanel />));
}

const byTestId = <T extends HTMLElement>(testId: string) =>
  container.querySelector<T>(`[data-testid="${testId}"]`);

const input = () => {
  const found = byTestId<HTMLTextAreaElement>("chat-input");
  if (found === null) throw new Error("no chat input");
  return found;
};

function type(text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set?.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
  });

beforeEach(() => {
  agent.messages = [];
  agent.busy = false;
  agent.prompt.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

test("invites the user to talk when there is no conversation", () => {
  render();
  expect(container.textContent).toContain("Talk to the agent");
});

test("sends on Enter and clears the composer", () => {
  render();
  type("  add a reverb  ");
  press("Enter");

  expect(agent.prompt).toHaveBeenCalledWith("add a reverb");
  expect(input().value).toBe("");
});

test("keeps Shift+Enter for a new line", () => {
  render();
  type("one");
  press("Enter", { shiftKey: true });

  expect(agent.prompt).not.toHaveBeenCalled();
});

test("does not send an empty message", () => {
  render();
  type("   ");
  press("Enter");

  expect(agent.prompt).not.toHaveBeenCalled();
  expect(byTestId<HTMLButtonElement>("chat-send")?.disabled).toBe(true);
});

test("bubbles only the user's messages", () => {
  agent.messages = [
    { id: "a", role: "user", text: "hello" },
    { id: "b", role: "assistant", text: "Hi there" },
  ];
  render();

  const variant = (role: string) =>
    container
      .querySelector(`[data-role="${role}"] [data-slot="bubble"]`)
      ?.getAttribute("data-variant");
  expect(variant("user")).toBe("secondary");
  expect(variant("assistant")).toBe("ghost");
});

test("offers Stop while the agent is replying", () => {
  agent.busy = true;
  agent.messages = [{ id: "a", role: "user", text: "hello" }];
  render();

  expect(container.textContent).toContain("Thinking…");
  act(() => byTestId("chat-stop")?.click());
  expect(agent.abort).toHaveBeenCalledTimes(1);
});

test("explains a message that could not be sent", async () => {
  agent.prompt.mockRejectedValue(new Error("No OpenRouter API key was given"));
  render();
  type("hello");
  press("Enter");
  await act(async () => {});

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "No OpenRouter API key was given",
  );
});
