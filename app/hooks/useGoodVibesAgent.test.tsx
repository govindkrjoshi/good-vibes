// @vitest-environment happy-dom

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiKeyStorageKey } from "../agent-key";
import {
  GoodVibesAgentProvider,
  useAgentGreeting,
  useGoodVibesAgent,
} from "./useGoodVibesAgent";

type Listener = (event: AgentEvent) => void;

const assistant = (text: string, extra: object = {}) => ({
  role: "assistant",
  content: text === "" ? [] : [{ type: "text", text }],
  stopReason: "stop",
  ...extra,
});

const reply = assistant("Hi there");

// Stands in for pi-agent-core's Agent: a prompt streams the user's message,
// then the agent's reply a word at a time.
const fakeAgent = () => {
  const listeners: Listener[] = [];
  const emit = (event: object) => {
    for (const listener of listeners) listener(event as AgentEvent);
  };
  const agent = {
    final: reply as object,
    subscribe: vi.fn((listener: Listener) => {
      listeners.push(listener);
      return () => {};
    }),
    prompt: vi.fn(async (text: string) => {
      const user = { role: "user", content: text };
      emit({ type: "message_start", message: user });
      emit({ type: "message_end", message: user });
      emit({ type: "message_start", message: assistant("") });
      emit({ type: "message_update", message: assistant("Hi") });
      emit({ type: "message_end", message: agent.final });
    }),
    abort: vi.fn(),
  };
  return agent;
};

let agent: ReturnType<typeof fakeAgent>;
const createGoodVibesAgent = vi.hoisted(() => vi.fn());
vi.mock("../agent", () => ({ createGoodVibesAgent }));

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useGoodVibesAgent> | undefined;

function Probe() {
  current = useGoodVibesAgent();
  return null;
}

function Greeter({ label = "" }: { readonly label?: string }) {
  useAgentGreeting();
  return label;
}

const tree = (children: ReactNode) => (
  <StrictMode>
    <GoodVibesAgentProvider>{children}</GoodVibesAgentProvider>
  </StrictMode>
);

function render(children: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(tree(children)));
}

// Lets pending promises (the lazy agent import, the reply) settle.
const flush = () => act(async () => {});

// The key the agent would send with its next request.
const agentKey = () =>
  (createGoodVibesAgent.mock.calls[0]?.[0] as (() => string) | undefined)?.();

const keyInput = () =>
  document.querySelector<HTMLInputElement>('input[type="password"]');

const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
};

function enterKey(key: string) {
  const input = keyInput();
  if (input === null) throw new Error("key dialog missing");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, key);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button("Save key").click());
}

beforeEach(() => {
  current = undefined;
  agent = fakeAgent();
  createGoodVibesAgent.mockReturnValue(agent);
  // happy-dom's dialog does not implement the modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  createGoodVibesAgent.mockReset();
  vi.restoreAllMocks();
});

test("uses the key saved in local storage without asking", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);

  await expect(current?.prompt("hello")).resolves.toBeUndefined();
  expect(agentKey()).toBe("sk-or-saved");
  expect(agent.prompt).toHaveBeenCalledWith("hello");
  expect(keyInput()).toBeNull();
});

test("asks for a key when none is known, then saves it", async () => {
  render(<Probe />);

  let done: Promise<void> | undefined;
  act(() => {
    done = current?.prompt("hello");
  });
  expect(keyInput()).not.toBeNull();
  expect(createGoodVibesAgent).not.toHaveBeenCalled();

  enterKey("  sk-or-typed  ");
  await flush();

  await expect(done).resolves.toBeUndefined();
  expect(agentKey()).toBe("sk-or-typed");
  expect(agent.prompt).toHaveBeenCalledWith("hello");
  expect(localStorage.getItem(apiKeyStorageKey)).toBe("sk-or-typed");
  expect(keyInput()).toBeNull();
});

test("prompts waiting on the key share one dialog and one agent", async () => {
  render(<Probe />);

  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  act(() => {
    first = current?.prompt("one");
    second = current?.prompt("two");
  });
  expect(document.querySelectorAll("dialog")).toHaveLength(1);

  enterKey("sk-or-typed");
  await flush();

  await expect(first).resolves.toBeUndefined();
  await expect(second).resolves.toBeUndefined();
  expect(createGoodVibesAgent).toHaveBeenCalledTimes(1);
  expect(agent.prompt.mock.calls).toEqual([["one"], ["two"]]);
});

test("keeps one agent across prompts", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);

  await current?.prompt("one");
  await current?.prompt("two");

  expect(createGoodVibesAgent).toHaveBeenCalledTimes(1);
  expect(agent.subscribe).toHaveBeenCalledTimes(1);
  expect(agent.prompt).toHaveBeenCalledTimes(2);
});

test("rejects when the user declines to give a key", async () => {
  render(<Probe />);

  let done: Promise<void> | undefined;
  act(() => {
    done = current?.prompt("hello");
  });
  act(() => button("Not now").click());

  await expect(done).rejects.toThrow("No OpenRouter API key was given");
  expect(createGoodVibesAgent).not.toHaveBeenCalled();
  expect(keyInput()).toBeNull();

  act(() => {
    done = current?.prompt("hello");
  });
  expect(keyInput()).not.toBeNull();
});

test("keeps the conversation as it streams in", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);

  await act(() => current?.prompt("hello"));

  expect(current?.messages).toEqual([
    { id: "message-0", role: "user", text: "hello" },
    { id: "message-1", role: "assistant", text: "Hi there" },
  ]);
});

test("is busy from sending until the reply ends", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  let finish!: () => void;
  render(<Probe />);
  agent.prompt.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );

  let done: Promise<void> | undefined;
  act(() => {
    done = current?.prompt("hello");
  });
  expect(current?.busy).toBe(true);

  await flush();
  await act(async () => {
    finish();
    await done;
  });
  expect(current?.busy).toBe(false);
});

test("shows why a reply failed", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  agent.final = assistant("", {
    stopReason: "error",
    errorMessage: "401 Unauthorized",
  });
  render(<Probe />);

  await act(() => current?.prompt("hello"));

  expect(current?.messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "",
    error: "401 Unauthorized",
  });
});

test("stops the running reply", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);
  await act(() => current?.prompt("hello"));

  act(() => current?.abort());
  await flush();

  expect(agent.abort).toHaveBeenCalledTimes(1);
});

test("uses a key changed in settings for the running agent", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);
  await act(() => current?.prompt("hello"));

  act(() => current?.changeKey());
  enterKey("sk-or-new");

  expect(agentKey()).toBe("sk-or-new");
  expect(localStorage.getItem(apiKeyStorageKey)).toBe("sk-or-new");
  expect(createGoodVibesAgent).toHaveBeenCalledTimes(1);
});

test("greets once on mount under Strict Mode without showing the prompt", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");

  render(
    <>
      <Greeter />
      <Probe />
    </>,
  );
  await flush();

  expect(agent.prompt).toHaveBeenCalledTimes(1);
  expect(agent.prompt).toHaveBeenCalledWith(
    "Say hello to the user of Good Vibes.",
  );
  expect(current?.messages).toEqual([
    { id: "message-0", role: "assistant", text: "Hi there" },
  ]);
});

test("does not greet again on rerender", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");

  render(<Greeter label="a" />);
  await flush();
  act(() => root.render(tree(<Greeter label="b" />)));
  await flush();

  expect(container.textContent).toBe("b");
  expect(agent.prompt).toHaveBeenCalledTimes(1);
});

test("warns instead of throwing when the greeting fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  agent.prompt.mockRejectedValue(new Error("Agent is already running"));

  render(<Greeter />);
  await flush();

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toBe("Agent greeting failed:");
});

test("throws when used outside the provider", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  expect(() => act(() => root.render(<Probe />))).toThrow(
    "useGoodVibesAgent must be used inside GoodVibesAgentProvider",
  );
});
