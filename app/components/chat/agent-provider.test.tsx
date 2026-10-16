// @vitest-environment happy-dom

import { Effect, PubSub, Stream } from "effect";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiKeyStorageKey } from "../../agent/key";
import { PromptError, type GoodVibesMessage } from "../../agent/types";
import { GoodVibesAgentProvider, useGoodVibesAgent } from "./agent-provider";

// Stands in for the agent: a prompt says its reply a word at a time, then
// settles however `outcome` says.
const fakeAgent = () => {
  const said = Effect.runSync(PubSub.unbounded<GoodVibesMessage>());
  const say = (message: GoodVibesMessage) =>
    PubSub.publishUnsafe(said, message);
  let reply = 0;
  const aborted = vi.fn();
  let outcome: Effect.Effect<void, PromptError> = Effect.void;
  const agent = {
    set outcome(value: Effect.Effect<void, PromptError>) {
      outcome = value;
    },
    prompt: vi.fn((text: string) =>
      Effect.suspend(() => {
        void text;
        reply += 1;
        say({ type: "message", id: `${reply}-0`, text: "Hi" });
        say({ type: "message", id: `${reply}-0`, text: "Hi there" });
        return outcome;
      }),
    ),
    messages: Stream.fromPubSub(said),
    abort: Effect.sync(() => aborted()),
    aborted,
  };
  return agent;
};

let agent: ReturnType<typeof fakeAgent>;
const createGoodVibesAgent = vi.hoisted(() => vi.fn());
vi.mock("../../agent/agent", () => ({ createGoodVibesAgent }));

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useGoodVibesAgent> | undefined;

function Probe() {
  current = useGoodVibesAgent();
  return null;
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

// Lets pending promises (the lazy agent import, the reply) and the
// service's fibers settle.
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
  createGoodVibesAgent.mockReturnValue(Effect.succeed(agent));
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

  act(() => current?.prompt("hello"));
  await flush();

  expect(agentKey()).toBe("sk-or-saved");
  expect(agent.prompt).toHaveBeenCalledWith("hello");
  expect(keyInput()).toBeNull();
});

test("asks for a key when none is known, then saves it", async () => {
  render(<Probe />);

  act(() => current?.prompt("hello"));
  await flush();
  expect(keyInput()).not.toBeNull();
  expect(createGoodVibesAgent).not.toHaveBeenCalled();

  enterKey("  sk-or-typed  ");
  await flush();

  expect(agentKey()).toBe("sk-or-typed");
  expect(agent.prompt).toHaveBeenCalledWith("hello");
  expect(localStorage.getItem(apiKeyStorageKey)).toBe("sk-or-typed");
  expect(keyInput()).toBeNull();
});

test("prompts waiting on the key share one dialog and one agent", async () => {
  render(<Probe />);

  act(() => {
    current?.prompt("one");
    current?.prompt("two");
  });
  await flush();
  expect(document.querySelectorAll("dialog")).toHaveLength(1);

  enterKey("sk-or-typed");
  await flush();

  expect(createGoodVibesAgent).toHaveBeenCalledTimes(1);
  expect(agent.prompt.mock.calls).toEqual([["one"], ["two"]]);
});

test("shows that no key was given, and asks again next time", async () => {
  render(<Probe />);

  act(() => current?.prompt("hello"));
  await flush();
  act(() => button("Not now").click());
  await flush();

  expect(current?.messages.at(-1)).toMatchObject({
    error: "No OpenRouter API key was given",
  });
  expect(createGoodVibesAgent).not.toHaveBeenCalled();
  expect(keyInput()).toBeNull();

  act(() => current?.prompt("hello"));
  await flush();
  expect(keyInput()).not.toBeNull();
});

test("keeps the conversation as it streams in", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);

  act(() => current?.prompt("hello"));
  await flush();

  expect(current?.messages.slice(0, 2)).toEqual([
    { id: "user-chain-1", role: "user", kind: "message", text: "hello" },
    { id: "agent-1-0", role: "assistant", kind: "message", text: "Hi there" },
  ]);
  // Rendered here with no sandbox, so the rack cannot be checked.
  expect(current?.messages.at(-1)).toMatchObject({
    role: "system",
    kind: "notice",
    text: "Could not check the rack for errors: the audio engine has not started yet.",
  });
});

test("is busy from sending until the reply ends, and queues what comes meanwhile", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  let finish!: () => void;
  render(<Probe />);
  agent.prompt.mockImplementationOnce(() =>
    Effect.promise(() => new Promise<void>((resolve) => (finish = resolve))),
  );

  act(() => current?.prompt("hello"));
  await flush();
  act(() => current?.prompt("and this"));
  expect(current).toMatchObject({ busy: true, queued: 1 });

  act(() => finish());
  await flush();
  expect(current).toMatchObject({ busy: false, queued: 0 });
  expect(agent.prompt.mock.calls).toEqual([["hello"], ["and this"]]);
});

test("shows why a reply failed", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  agent.prompt.mockImplementationOnce(() =>
    Effect.fail(new PromptError({ message: "401 Unauthorized" })),
  );
  render(<Probe />);

  act(() => current?.prompt("hello"));
  await flush();

  expect(current?.messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "",
    error: "401 Unauthorized",
  });
});

test("stops the running reply", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);
  agent.prompt.mockImplementationOnce(() =>
    Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(agent.aborted))),
  );
  act(() => current?.prompt("hello"));
  await flush();

  act(() => current?.abort());
  await flush();

  expect(agent.aborted).toHaveBeenCalledTimes(1);
  expect(current?.busy).toBe(false);
});

test("uses a key changed in settings for the running agent", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);
  act(() => current?.prompt("hello"));
  await flush();

  act(() => current?.changeKey());
  enterKey("sk-or-new");

  expect(agentKey()).toBe("sk-or-new");
  expect(localStorage.getItem(apiKeyStorageKey)).toBe("sk-or-new");
  expect(createGoodVibesAgent).toHaveBeenCalledTimes(1);
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
