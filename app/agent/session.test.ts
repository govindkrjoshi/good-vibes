import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSession, type Session } from "./session";

type Listener = (event: AgentEvent) => void;

const assistant = (text: string, extra: object = {}) => ({
  role: "assistant",
  content: text === "" ? [] : [{ type: "text", text }],
  stopReason: "stop",
  ...extra,
});

// Stands in for pi-agent-core's Agent: a prompt streams the user's message,
// then the agent's reply a word at a time.
const fakeAgent = () => {
  const listeners: Listener[] = [];
  const emit = (event: object) => {
    for (const listener of listeners) listener(event as AgentEvent);
  };
  const agent = {
    final: assistant("Hi there") as object,
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
const createAgent = vi.fn();
const askForKey = vi.fn<() => Promise<string>>();

const session = (): Session => createSession({ askForKey, createAgent });

// The key the agent would send with its next request.
const agentKey = () =>
  (createAgent.mock.calls[0]?.[0] as (() => string) | undefined)?.();

// Lets pending promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  agent = fakeAgent();
  createAgent.mockImplementation(async () => agent as unknown as Agent);
  askForKey.mockResolvedValue("sk-or-typed");
});

afterEach(() => {
  createAgent.mockReset();
  askForKey.mockReset();
});

test("asks for a key when none is known, then uses it", async () => {
  const chat = session();

  await chat.prompt("hello");

  expect(askForKey).toHaveBeenCalledTimes(1);
  expect(agentKey()).toBe("sk-or-typed");
  expect(agent.prompt).toHaveBeenCalledWith("hello");
});

test("prompts waiting on the key share one answer and one agent", async () => {
  const chat = session();

  await Promise.all([chat.prompt("one"), chat.prompt("two")]);

  expect(askForKey).toHaveBeenCalledTimes(1);
  expect(createAgent).toHaveBeenCalledTimes(1);
  expect(agent.prompt.mock.calls).toEqual([["one"], ["two"]]);
});

test("keeps one agent across prompts", async () => {
  const chat = session();

  await chat.prompt("one");
  await chat.prompt("two");

  expect(createAgent).toHaveBeenCalledTimes(1);
  expect(agent.subscribe).toHaveBeenCalledTimes(1);
  expect(agent.prompt).toHaveBeenCalledTimes(2);
});

test("fails the prompt when no key is given, and asks again next time", async () => {
  askForKey.mockRejectedValueOnce(new Error("No OpenRouter API key was given"));
  const chat = session();

  await expect(chat.prompt("hello")).rejects.toThrow(
    "No OpenRouter API key was given",
  );
  expect(createAgent).not.toHaveBeenCalled();

  await chat.prompt("hello");
  expect(askForKey).toHaveBeenCalledTimes(2);
  expect(agent.prompt).toHaveBeenCalledWith("hello");
});

test("keeps the conversation as it streams in", async () => {
  const chat = session();
  const seen: number[] = [];
  chat.subscribe(() => seen.push(chat.getState().messages.length));

  await chat.prompt("hello");

  expect(chat.getState().messages).toEqual([
    { id: "message-0", role: "user", text: "hello" },
    { id: "message-1", role: "assistant", text: "Hi there" },
  ]);
  expect(seen).toContain(1);
});

test("is busy from sending until the reply ends", async () => {
  const chat = session();
  let finish!: () => void;
  agent.prompt.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );

  const done = chat.prompt("hello");
  expect(chat.getState().busy).toBe(true);

  await flush();
  finish();
  await done;
  expect(chat.getState().busy).toBe(false);
});

test("shows why a reply failed", async () => {
  agent.final = assistant("", {
    stopReason: "error",
    errorMessage: "401 Unauthorized",
  });
  const chat = session();

  await chat.prompt("hello");

  expect(chat.getState().messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "",
    error: "401 Unauthorized",
  });
});

test("stops the running reply", async () => {
  const chat = session();
  await chat.prompt("hello");

  chat.abort();
  await flush();

  expect(agent.abort).toHaveBeenCalledTimes(1);
});

test("does nothing on abort before any agent exists", async () => {
  const chat = session();

  chat.abort();
  await flush();

  expect(createAgent).not.toHaveBeenCalled();
});

test("uses a key changed later for the running agent", async () => {
  const chat = session();
  await chat.prompt("hello");

  chat.setKey("sk-or-new");

  expect(agentKey()).toBe("sk-or-new");
  expect(createAgent).toHaveBeenCalledTimes(1);
});
