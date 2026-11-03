import { Effect, PubSub, Stream } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GoodVibesAgent } from "./agent";
import { createSession, type CreateAgent, type Session } from "./session";
import { useStore } from "../stores";
import { PromptError, type GoodVibesMessage } from "./types";

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
    say,
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
const createAgent = vi.fn<CreateAgent>();
const askForKey = vi.fn<() => Promise<string>>();

const session = (): Session =>
  createSession({ askForKey, store: useStore, createAgent });

// The key the agent would send with its next request.
const agentKey = () => createAgent.mock.calls[0]?.[0]();

// Lets pending promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  agent = fakeAgent();
  createAgent.mockImplementation(() => Effect.succeed(agent as GoodVibesAgent));
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
  expect(agent.prompt).toHaveBeenCalledTimes(2);
});

test("fails the prompt when no key is given, and asks again next time", async () => {
  askForKey.mockRejectedValueOnce(new Error("No OpenRouter API key was given"));
  const chat = session();

  await expect(chat.prompt("hello")).rejects.toThrow(
    "No OpenRouter API key was given",
  );
  expect(createAgent).not.toHaveBeenCalled();
  expect(chat.getState().messages).toEqual([]);

  await chat.prompt("hello");
  expect(askForKey).toHaveBeenCalledTimes(2);
  expect(agent.prompt).toHaveBeenCalledWith("hello");
});

test("keeps the conversation as it streams in", async () => {
  const chat = session();
  const seen: string[][] = [];
  chat.subscribe(() =>
    seen.push(chat.getState().messages.map((message) => message.text)),
  );

  await chat.prompt("hello");

  expect(chat.getState().messages).toEqual([
    { id: "user-0", role: "user", kind: "message", text: "hello" },
    { id: "agent-1-0", role: "assistant", kind: "message", text: "Hi there" },
  ]);
  expect(seen).toContainEqual(["hello", "Hi"]);
});

test("shows the agent's thoughts apart from what it says", async () => {
  agent.prompt.mockImplementationOnce(() =>
    Effect.sync(() => {
      agent.say({ type: "thought", id: "1-0", text: "They said hello." });
      agent.say({ type: "message", id: "1-1", text: "Hi there" });
    }),
  );
  const chat = session();

  await chat.prompt("hello");

  expect(chat.getState().messages.slice(1)).toEqual([
    {
      id: "agent-1-0",
      role: "assistant",
      kind: "thought",
      text: "They said hello.",
    },
    { id: "agent-1-1", role: "assistant", kind: "message", text: "Hi there" },
  ]);
});

test("shows what the agent does to the rack, pending until done", async () => {
  agent.prompt.mockImplementationOnce(() =>
    Effect.sync(() => {
      agent.say({
        type: "tool",
        id: "tool-1",
        text: "Adding a rack…",
        done: false,
      });
      agent.say({
        type: "tool",
        id: "tool-1",
        text: "Added [bass] MonoSynth",
        done: true,
      });
      agent.say({
        type: "tool",
        id: "tool-2",
        text: "Patching failed",
        done: true,
        error: "There is no jack bass:output",
      });
      agent.say({ type: "message", id: "1-2", text: "Done" });
    }),
  );
  const chat = session();
  const seen: (boolean | undefined)[] = [];
  chat.subscribe(() => seen.push(chat.getState().messages.at(-1)?.pending));

  await chat.prompt("add a bass");

  expect(chat.getState().messages.slice(1)).toEqual([
    {
      id: "agent-tool-1",
      role: "assistant",
      kind: "tool",
      text: "Added [bass] MonoSynth",
      pending: false,
    },
    {
      id: "agent-tool-2",
      role: "assistant",
      kind: "tool",
      text: "Patching failed",
      pending: false,
      error: "There is no jack bass:output",
    },
    { id: "agent-1-2", role: "assistant", kind: "message", text: "Done" },
  ]);
  expect(seen).toContain(true);
});

test("is busy from sending until the reply ends", async () => {
  const chat = session();
  let finish!: () => void;
  agent.prompt.mockImplementationOnce(() =>
    Effect.promise(() => new Promise<void>((resolve) => (finish = resolve))),
  );

  const done = chat.prompt("hello");
  expect(chat.getState().busy).toBe(true);

  await flush();
  finish();
  await done;
  expect(chat.getState().busy).toBe(false);
});

test("shows why a reply failed", async () => {
  agent.prompt.mockImplementationOnce(() =>
    Effect.fail(new PromptError({ message: "401 Unauthorized" })),
  );
  const chat = session();

  await chat.prompt("hello");

  expect(chat.getState().messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "",
    error: "401 Unauthorized",
  });
});

test("shows a failure on the reply it cut short", async () => {
  agent.outcome = Effect.fail(new PromptError({ message: "Connection lost" }));
  const chat = session();

  await chat.prompt("hello");

  expect(chat.getState().messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "Hi there",
    error: "Connection lost",
  });
});

test("stops the running reply", async () => {
  const chat = session();
  await chat.prompt("hello");

  chat.abort();
  await flush();

  expect(agent.aborted).toHaveBeenCalledTimes(1);
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

test("stops listening once closed", async () => {
  const chat = session();
  await chat.prompt("hello");

  await chat.close();
  agent.say({ type: "message", id: "9-0", text: "Still here?" });
  await flush();

  expect(chat.getState().messages).toHaveLength(2);
});
