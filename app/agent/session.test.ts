import { Effect, PubSub, Stream } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GoodVibesAgent } from "./agent";
import { createSession, type CreateAgent, type Session } from "./session";
import { announced, type ApplyAction, type RequestAction } from "./tools";
import {
  PromptError,
  type ActionResult,
  type GoodVibesMessage,
  type RackAction,
} from "./types";

// Stands in for the agent: a prompt says its reply a word at a time, then
// settles however `outcome` says. `ask` applies an action through what the
// session handed the agent, announcing it as the real agent does.
const fakeAgent = () => {
  const said = Effect.runSync(PubSub.unbounded<GoodVibesMessage>());
  const say = (message: GoodVibesMessage) =>
    PubSub.publishUnsafe(said, message);
  let reply = 0;
  const aborted = vi.fn();
  let request: RequestAction = () =>
    Promise.reject(new Error("The session made no agent"));
  let outcome: Effect.Effect<void, PromptError> = Effect.void;
  const agent = {
    set outcome(value: Effect.Effect<void, PromptError>) {
      outcome = value;
    },
    say,
    applyWith: (apply: ApplyAction) => {
      request = announced(say, apply);
    },
    ask: (action: RackAction) => request(action),
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
const applyAction = vi.fn<(action: RackAction) => ActionResult>();

const session = (): Session =>
  createSession({ askForKey, applyAction, createAgent });

// The key the agent would send with its next request.
const agentKey = () => createAgent.mock.calls[0]?.[0]();

// Lets pending promises settle.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  agent = fakeAgent();
  createAgent.mockImplementation((_, apply) => {
    agent.applyWith(apply);
    return Effect.succeed(agent as GoodVibesAgent);
  });
  askForKey.mockResolvedValue("sk-or-typed");
  applyAction.mockReturnValue({ ok: true, text: "Added AMSynth." });
});

afterEach(() => {
  createAgent.mockReset();
  askForKey.mockReset();
  applyAction.mockReset();
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

const addSynth: RackAction = {
  kind: "add_block",
  id: "synth-1",
  category: "instruments",
  entry: "AMSynth",
};

test("hands the agent what applies its actions, and shows them in the chat", async () => {
  const chat = session();
  const seen: (string | undefined)[] = [];
  chat.subscribe(() => seen.push(chat.getState().messages.at(-1)?.status));
  let result: ActionResult | undefined;
  agent.prompt.mockImplementationOnce(() =>
    Effect.promise(async () => {
      result = await agent.ask(addSynth);
      agent.say({ type: "message", id: "1-1", text: "Done" });
    }),
  );

  await chat.prompt("add a synth");

  expect(applyAction).toHaveBeenCalledWith(addSynth, undefined);
  expect(result).toEqual({ ok: true, text: "Added AMSynth." });
  expect(seen).toContain("requested");
  expect(chat.getState().messages.slice(1)).toEqual([
    {
      id: "agent-action-0",
      role: "assistant",
      kind: "action",
      text: "Added AMSynth.",
      status: "done",
    },
    { id: "agent-1-1", role: "assistant", kind: "message", text: "Done" },
  ]);
});

test("shows a refused action with why", async () => {
  applyAction.mockReturnValue({ ok: false, text: "No such block." });
  agent.prompt.mockImplementationOnce(() =>
    Effect.promise(async () => {
      await agent.ask({ kind: "remove_blocks", blockIds: ["nope"] });
    }),
  );
  const chat = session();

  await chat.prompt("remove it");

  expect(chat.getState().messages.at(-1)).toEqual({
    id: "agent-action-0",
    role: "assistant",
    kind: "action",
    text: "Removing a block",
    status: "failed",
    error: "No such block.",
  });
});

test("tells the agent when applying throws, and shows it failed", async () => {
  applyAction.mockImplementation(() => {
    throw new Error("Store is gone");
  });
  let result: ActionResult | undefined;
  agent.prompt.mockImplementationOnce(() =>
    Effect.promise(async () => {
      result = await agent.ask({ kind: "describe" });
    }),
  );
  const chat = session();

  await chat.prompt("what is there?");

  expect(result).toEqual({ ok: false, text: "Store is gone" });
  expect(chat.getState().messages.at(-1)).toMatchObject({
    kind: "action",
    status: "failed",
    error: "Store is gone",
  });
});
