// @vitest-environment happy-dom

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Effect, PubSub, Stream } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GoodVibesAgent } from "./agent";
import { noKeyGiven } from "./explain";
import { chatStorageKey } from "./history";
import type { Credential } from "./providers";
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
  const wasReset = vi.fn();
  let outcome: Effect.Effect<void, PromptError> = Effect.void;
  // What the model would remember: each prompt and a reply to it.
  let transcript: AgentMessage[] = [];
  const agent = {
    set outcome(value: Effect.Effect<void, PromptError>) {
      outcome = value;
    },
    say,
    prompt: vi.fn((text: string) =>
      Effect.suspend(() => {
        reply += 1;
        transcript = [
          ...transcript,
          { role: "user", content: text, timestamp: 0 },
          {
            role: "assistant",
            content: [{ type: "text", text: "Hi there" }],
            stopReason: "stop",
          } as AgentMessage,
        ];
        say({ type: "message", id: `${reply}-0`, text: "Hi" });
        say({ type: "message", id: `${reply}-0`, text: "Hi there" });
        return outcome;
      }),
    ),
    messages: Stream.fromPubSub(said),
    abort: Effect.sync(() => aborted()),
    transcript: Effect.sync(() => transcript),
    reset: Effect.sync(() => {
      transcript = [];
      wasReset();
    }),
    aborted,
    wasReset,
  };
  return agent;
};

let agent: ReturnType<typeof fakeAgent>;
const createAgent = vi.fn<CreateAgent>();
const askForKey = vi.fn<() => Promise<Credential>>();

const session = (): Session =>
  createSession({ askForKey, store: useStore, createAgent });

// The key the agent would send with its next request.
const agentKey = () => createAgent.mock.calls[0]?.[0]().key;

// Lets pending promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  agent = fakeAgent();
  createAgent.mockImplementation(() => Effect.succeed(agent as GoodVibesAgent));
  askForKey.mockResolvedValue({ provider: "openrouter", key: "sk-or-typed" });
});

afterEach(() => {
  createAgent.mockReset();
  askForKey.mockReset();
  localStorage.clear();
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
  askForKey.mockRejectedValueOnce(new Error(noKeyGiven));
  const chat = session();

  await expect(chat.prompt("hello")).rejects.toThrow(noKeyGiven);
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

test("shows what the agent says it is about to do", async () => {
  agent.prompt.mockImplementationOnce(() =>
    Effect.sync(() => {
      agent.say({ type: "brief", id: "brief-1", text: "I'll say hello." });
      agent.say({ type: "message", id: "1-1", text: "Hi there" });
    }),
  );
  const chat = session();

  await chat.prompt("hello");

  expect(chat.getState().messages.slice(1)).toEqual([
    {
      id: "agent-brief-1",
      role: "assistant",
      kind: "brief",
      text: "I'll say hello.",
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
        args: { item: "tone/MonoSynth" },
      });
      agent.say({
        type: "tool",
        id: "tool-1",
        text: "Added [bass] MonoSynth",
        done: true,
        args: { item: "tone/MonoSynth" },
        result: "Added [bass] MonoSynth\nJacks: bass:in, bass:out",
      });
      agent.say({
        type: "tool",
        id: "tool-2",
        text: "Patching failed",
        done: true,
        args: { from: "bass:output", to: "out:in" },
        result: "There is no jack bass:output",
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
      args: { item: "tone/MonoSynth" },
      result: "Added [bass] MonoSynth\nJacks: bass:in, bass:out",
    },
    {
      id: "agent-tool-2",
      role: "assistant",
      kind: "tool",
      text: "Patching failed",
      pending: false,
      args: { from: "bass:output", to: "out:in" },
      result: "There is no jack bass:output",
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

test("shows why a reply failed, in plain words, with the way to a key", async () => {
  agent.prompt.mockImplementationOnce(() =>
    Effect.fail(
      new PromptError({
        message: '401: {"message":"No auth credentials found"}',
      }),
    ),
  );
  const chat = session();

  await chat.prompt("hello");

  expect(chat.getState().messages.at(-1)).toMatchObject({
    role: "assistant",
    text: "",
    error: "OpenRouter rejected the key. Check it and try again.",
    recover: "key",
  });
});

test("marks the reply the user stopped", async () => {
  const chat = session();
  let finish!: () => void;
  agent.prompt.mockImplementationOnce(() =>
    Effect.suspend(() => {
      agent.say({ type: "message", id: "1-0", text: "Hi th" });
      return Effect.promise(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
    }),
  );

  const done = chat.prompt("hello");
  await flush();
  chat.abort();
  await flush();
  finish();
  await done;

  expect(chat.getState().messages.at(-1)).toMatchObject({
    text: "Hi th",
    stopped: true,
  });
});

test("keeps the conversation in this browser and carries it on after a reload", async () => {
  const chat = session();
  await chat.prompt("hello");
  await chat.prompt("again");

  const stored = JSON.parse(localStorage.getItem(chatStorageKey) ?? "{}");
  expect(stored.messages.map((m: { text: string }) => m.text)).toEqual([
    "hello",
    "Hi there",
    "again",
    "Hi there",
  ]);
  expect(stored.transcript).toHaveLength(4);

  // The next page load: a new session, a new agent handed the history.
  createAgent.mockClear();
  const later = session();
  expect(later.getState().messages).toHaveLength(4);

  await later.prompt("still there?");

  expect(createAgent.mock.calls[0]?.[2]).toEqual({
    history: stored.transcript,
  });
  expect(later.getState().messages).toHaveLength(6);
});

test("leaves a reply that failed out of what the model carries on from", async () => {
  const chat = session();
  await chat.prompt("hello");
  agent.prompt.mockImplementationOnce(() =>
    Effect.suspend(() => {
      agent.say({ type: "message", id: "2-0", text: "" });
      return Effect.fail(new PromptError({ message: "Connection lost" }));
    }),
  );
  await chat.prompt("again");

  const stored = JSON.parse(localStorage.getItem(chatStorageKey) ?? "{}");
  expect(stored.messages).toHaveLength(4);
  expect(stored.transcript).toHaveLength(2);
});

test("starts over on reset, here and in storage", async () => {
  const chat = session();
  await chat.prompt("hello");
  expect(localStorage.getItem(chatStorageKey)).not.toBeNull();

  chat.reset();
  await flush();

  expect(chat.getState().messages).toEqual([]);
  expect(localStorage.getItem(chatStorageKey)).toBeNull();
  expect(agent.wasReset).toHaveBeenCalledTimes(1);

  await chat.prompt("hello again");
  expect(createAgent).toHaveBeenCalledTimes(1);
  expect(chat.getState().messages).toHaveLength(2);
});

test("ignores stored chat it cannot read", () => {
  localStorage.setItem(chatStorageKey, "{not json");
  expect(session().getState().messages).toEqual([]);
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

  chat.setKey({ provider: "openai", key: "sk-new" });

  expect(agentKey()).toBe("sk-new");
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
