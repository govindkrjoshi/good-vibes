// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { newTree } from "../../rack";
import { useStore } from "../../stores";
import type { ChatMessage } from "./agent-provider";
import { ChatPanel } from "./chat-panel";

const agent = vi.hoisted(() => ({
  messages: [] as ChatMessage[],
  busy: false,
  prompt: vi.fn(),
  abort: vi.fn(),
  chats: [] as {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
  }[],
  selectedId: undefined as string | undefined,
  newChat: vi.fn(),
  openChat: vi.fn(),
  deleteChat: vi.fn(),
  saveError: undefined as string | undefined,
  changeKey: vi.fn(),
}));

vi.mock("./agent-provider", () => ({
  useGoodVibesAgent: () => agent,
}));

let container: HTMLDivElement;
let root: Root;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // The chat sits inside the canvas's provider, so its chips can find racks.
  act(() =>
    root.render(
      <ReactFlowProvider>
        <ChatPanel />
      </ReactFlowProvider>,
    ),
  );
}

const initial = useStore.getState();

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
  agent.chats = [];
  agent.selectedId = undefined;
  agent.saveError = undefined;
  agent.prompt.mockResolvedValue(undefined);
  useStore.setState(initial, true);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

test("invites the user to talk when there is no conversation", () => {
  render();
  expect(container.textContent).toContain("Talk to the agent");
  expect(byTestId<HTMLButtonElement>("chat-new")?.disabled).toBe(true);
});

test("offers things to ask, each sent whole", () => {
  render();
  const openers = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="chat-opener"]',
  );
  expect(openers.length).toBeGreaterThanOrEqual(3);

  act(() => openers[0]?.click());

  expect(agent.prompt).toHaveBeenCalledWith(openers[0]?.textContent);
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
    { id: "a", role: "user", kind: "message", text: "hello" },
    { id: "b", role: "assistant", kind: "message", text: "Hi there" },
  ];
  render();

  const variant = (role: string) =>
    container
      .querySelector(`[data-role="${role}"] [data-slot="bubble"]`)
      ?.getAttribute("data-variant");
  expect(variant("user")).toBe("secondary");
  expect(variant("assistant")).toBe("ghost");
});

test("shows what the agent did to the rack as lines under what it said it would do", () => {
  agent.messages = [
    { id: "a", role: "user", kind: "message", text: "add a bass" },
    {
      id: "p",
      role: "assistant",
      kind: "brief",
      text: "I'll add a bass and patch it in.",
    },
    {
      id: "b",
      role: "assistant",
      kind: "tool",
      text: "Adding a rack…",
      pending: true,
      args: { item: "tone/MonoSynth" },
    },
    {
      id: "c",
      role: "assistant",
      kind: "tool",
      text: "Patching failed",
      args: { from: "bass:output", to: "out:in" },
      result: "There is no jack bass:output",
      error: "There is no jack bass:output",
    },
    { id: "d", role: "assistant", kind: "message", text: "Nearly." },
    { id: "e", role: "assistant", kind: "tool", text: "Read the rack" },
  ];
  render();

  const runs = container.querySelectorAll('[data-kind="run"]');
  expect(runs).toHaveLength(2);
  expect(runs[0]?.querySelector('[data-kind="brief"]')?.textContent).toBe(
    "I'll add a bass and patch it in.",
  );
  expect(runs[0]?.querySelectorAll('[data-kind="tool"]')).toHaveLength(2);
  expect(runs[1]?.querySelector('[data-kind="brief"]')).toBeNull();
  expect(runs[1]?.querySelectorAll('[data-kind="tool"]')).toHaveLength(1);

  const rows = container.querySelectorAll('[data-kind="tool"]');
  expect(rows[0]?.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(rows[0]?.querySelector('[data-slot="bubble"]')).toBeNull();
  expect(rows[1]?.querySelector('[data-slot="spinner"]')).toBeNull();
  expect(rows[1]?.textContent).toContain("There is no jack bass:output");
});

test("opens a tool to what it was asked and what it reported", () => {
  agent.messages = [
    {
      id: "b",
      role: "assistant",
      kind: "tool",
      text: "Added [bass] MonoSynth",
      args: { item: "tone/MonoSynth", id: "bass" },
      result: "Added [bass] MonoSynth\nJacks: bass:in, bass:out",
    },
  ];
  render();
  const row = container.querySelector('[data-kind="tool"]');
  const trigger = row?.querySelector<HTMLButtonElement>("button");
  expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  expect(row?.textContent).not.toContain("Jacks: bass:in");

  act(() => trigger?.click());

  expect(trigger?.getAttribute("aria-expanded")).toBe("true");
  expect(row?.textContent).toContain("tone/MonoSynth");
  expect(row?.textContent).toContain("Jacks: bass:in, bass:out");
});

test("names a rack on the canvas as a chip that finds it", () => {
  const { rack } = useStore.getState();
  rack.addRackFromCatalogue("tone/MonoSynth", rack.rootId, "bass");
  agent.messages = [
    {
      id: "b",
      role: "assistant",
      kind: "tool",
      text: "Patched [62c635bc-abfd-47c4-9650-3059ac85bc1e] bass:out -> out:in",
    },
    {
      id: "c",
      role: "assistant",
      kind: "tool",
      text: "Added [bass] MonoSynth",
    },
    {
      id: "d",
      role: "assistant",
      kind: "tool",
      text: "Moved [pad] into [fx].",
    },
  ];
  render();

  const chips = container.querySelectorAll('[data-testid="rack-chip"]');
  expect(chips).toHaveLength(1);
  expect(chips[0]?.textContent).toBe("bass");
  // A generated id is left off the line; another rack's name stays.
  expect(container.textContent).toContain("Patched bass:out -> out:in");
  expect(container.textContent).toContain("Moved pad into fx.");
});

test("says a reply was stopped", () => {
  agent.messages = [
    { id: "a", role: "user", kind: "message", text: "hello" },
    {
      id: "b",
      role: "assistant",
      kind: "message",
      text: "Hi th",
      stopped: true,
    },
  ];
  render();

  expect(container.querySelector('[data-kind="stopped"]')?.textContent).toBe(
    "Stopped",
  );
});

test("offers the key dialog when a new key is the fix", () => {
  agent.messages = [
    {
      id: "b",
      role: "assistant",
      kind: "message",
      text: "",
      error: "OpenRouter rejected the key. Check it and try again.",
      recover: "key",
    },
  ];
  render();

  act(() => byTestId("chat-change-key")?.click());

  expect(agent.changeKey).toHaveBeenCalledTimes(1);
});

test("starts a new conversation", () => {
  agent.messages = [{ id: "a", role: "user", kind: "message", text: "hello" }];
  render();

  act(() => byTestId("chat-new")?.click());

  expect(agent.newChat).toHaveBeenCalledTimes(1);
});

test("starts a new conversation from a rack built without one", () => {
  render();
  expect(byTestId<HTMLButtonElement>("chat-new")?.disabled).toBe(true);
  act(() => useStore.getState().rack.addRack(newTree("t", "root"), "root"));

  expect(byTestId<HTMLButtonElement>("chat-new")?.disabled).toBe(false);
});

test("names the open conversation", () => {
  agent.chats = [
    { id: "a", title: "Bass line", createdAt: 1, updatedAt: 2 },
    { id: "b", title: "Reverb", createdAt: 1, updatedAt: 1 },
  ];
  agent.selectedId = "a";
  render();

  expect(byTestId("chat-picker")?.textContent).toContain("Bass line");
});

test("says when the chat could not be kept", () => {
  agent.saveError = "This chat could not be saved in this browser.";
  render();

  expect(container.textContent).toContain("could not be saved");
});

test("keeps thinking once a tool is done and the agent carries on", () => {
  agent.busy = true;
  agent.messages = [
    { id: "a", role: "user", kind: "message", text: "add a bass" },
    { id: "b", role: "assistant", kind: "tool", text: "Added a rack" },
  ];
  render();

  expect(container.textContent).toContain("Thinking…");
});

test("offers Stop while the agent is replying", () => {
  agent.busy = true;
  agent.messages = [{ id: "a", role: "user", kind: "message", text: "hello" }];
  render();

  expect(container.textContent).toContain("Thinking…");
  act(() => byTestId("chat-stop")?.click());
  expect(agent.abort).toHaveBeenCalledTimes(1);
});

test("explains a message that could not be sent, with the way to a key", async () => {
  agent.prompt.mockRejectedValue(new Error("No API key was given"));
  render();
  type("hello");
  press("Enter");
  await act(async () => {});

  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(
    "The agent needs an API key before it can reply.",
  );
  expect(
    alert?.querySelector('[data-testid="chat-change-key"]'),
  ).not.toBeNull();
});
