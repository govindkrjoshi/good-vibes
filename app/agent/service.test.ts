// @vitest-environment happy-dom

import { Effect, Exit, PubSub, Scope, Stream } from "effect";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GoodVibesAgent } from "./agent";
import {
  makeAgentService,
  type AgentService,
  type AgentServiceOptions,
  type CreateAgent,
  type FixupCheck,
  type Turn,
} from "./service";
import type { ApplyAction } from "./tools";
import {
  PromptError,
  type ActionResult,
  type GoodVibesMessage,
  type RackAction,
} from "./types";

// Stands in for the agent: each prompt says "Hi there" a word at a time, then
// runs what the test scripted for that prompt, if anything. `ask` applies an
// action through what the service handed the agent.
const fakeAgent = () => {
  const said = Effect.runSync(PubSub.unbounded<GoodVibesMessage>());
  const say = (message: GoodVibesMessage) =>
    PubSub.publishUnsafe(said, message);
  let apply: ApplyAction = () => ({ ok: false, text: "no apply" });
  let reply = 0;
  const scripts: Effect.Effect<void, PromptError>[] = [];
  const agent = {
    say,
    useApply: (given: ApplyAction) => {
      apply = given;
    },
    ask: (action: RackAction) => Promise.resolve(apply(action)),
    // What the next prompts do, in order, after saying hello.
    script: (...next: Effect.Effect<void, PromptError>[]) => {
      scripts.push(...next);
    },
    prompt: vi.fn((text: string) =>
      Effect.suspend(() => {
        void text;
        reply += 1;
        say({ type: "message", id: `${reply}-0`, text: "Hi" });
        say({ type: "message", id: `${reply}-0`, text: "Hi there" });
        return scripts.shift() ?? Effect.void;
      }),
    ),
    messages: Stream.fromPubSub(said),
    abort: Effect.void,
  };
  return agent;
};

let agent: ReturnType<typeof fakeAgent>;
const createAgent = vi.fn<CreateAgent>();
const applyAction = vi.fn<AgentServiceOptions["applyAction"]>();
const checkAfterTurn = vi.fn<(signal: AbortSignal) => Promise<FixupCheck>>();
let scope: Scope.Closeable;
let service: AgentService;

const start = (options: Partial<AgentServiceOptions> = {}) => {
  scope = Effect.runSync(Scope.make());
  service = Effect.runSync(
    makeAgentService({
      applyAction,
      checkAfterTurn,
      createAgent,
      ...options,
    }).pipe(Scope.provide(scope)),
  );
  return service;
};

const chat = () => service.chat.getState();
const texts = () =>
  chat().messages.map(
    ({ role, kind, text, error }) =>
      `${role}/${kind}: ${text}${error === undefined ? "" : ` [${error}]`}`,
  );

// Lets the service's fibers and pending promises run.
const flush = async () => {
  for (let i = 0; i < 5; i += 1)
    await new Promise((resolve) => setTimeout(resolve, 0));
};

// A promise the test resolves when it likes.
const later = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

beforeEach(() => {
  localStorage.setItem("good-vibes:openrouter-api-key", "sk-or-saved");
  agent = fakeAgent();
  createAgent.mockImplementation((_, apply) => {
    agent.useApply(apply);
    return Effect.succeed(agent as unknown as GoodVibesAgent);
  });
  applyAction.mockReturnValue({ ok: true, text: "Done." });
  checkAfterTurn.mockResolvedValue({ _tag: "Clean" });
});

afterEach(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void));
  localStorage.clear();
  vi.clearAllMocks();
});

// --- Keys and the agent -------------------------------------------------------

test("asks for a key when none is known, then uses it", async () => {
  localStorage.clear();
  start();

  service.prompt("hello");
  await flush();
  expect(chat().keyNeeded).toBe(true);
  expect(createAgent).not.toHaveBeenCalled();

  service.submitKey("sk-or-typed");
  await flush();

  expect(chat().keyNeeded).toBe(false);
  expect(createAgent.mock.calls[0]?.[0]()).toBe("sk-or-typed");
  expect(agent.prompt).toHaveBeenCalledWith("hello");
  expect(localStorage.getItem("good-vibes:openrouter-api-key")).toBe(
    "sk-or-typed",
  );
});

test("fails the prompt when no key is given, and asks again next time", async () => {
  localStorage.clear();
  start();

  service.prompt("hello");
  await flush();
  service.declineKey();
  await flush();

  expect(texts()).toEqual([
    "user/message: hello",
    "assistant/message:  [No OpenRouter API key was given]",
  ]);
  expect(chat().busy).toBe(false);
  expect(checkAfterTurn).not.toHaveBeenCalled();

  service.prompt("again");
  await flush();
  expect(chat().keyNeeded).toBe(true);
});

test("keeps one agent across prompts, and reads a key changed later", async () => {
  start();
  service.prompt("one");
  service.prompt("two");
  await flush();

  service.setKey("sk-or-new");

  expect(createAgent).toHaveBeenCalledTimes(1);
  expect(agent.prompt).toHaveBeenCalledTimes(2);
  expect(createAgent.mock.calls[0]?.[0]()).toBe("sk-or-new");
});

// --- The conversation -----------------------------------------------------------

test("keeps the conversation as it streams in, thoughts apart", async () => {
  start();
  agent.script(
    Effect.sync(() => agent.say({ type: "thought", id: "1-1", text: "Hmm" })),
  );

  service.prompt("hello");
  await flush();

  expect(texts()).toEqual([
    "user/message: hello",
    "assistant/message: Hi there",
    "assistant/thought: Hmm",
  ]);
});

test("shows why a reply failed, and asks for no fix-ups after it", async () => {
  start();
  agent.script(Effect.fail(new PromptError({ message: "Rate limited" })));

  service.prompt("hello");
  await flush();

  expect(texts().at(-1)).toBe("assistant/message: Hi there [Rate limited]");
  expect(checkAfterTurn).not.toHaveBeenCalled();
});

test("shows the agent's actions, applied for the turn that asked", async () => {
  start();
  const seen: Turn[] = [];
  applyAction.mockImplementation((_, __, turn) => {
    if (turn !== undefined) seen.push(turn);
    return { ok: true, text: "Added AMSynth." };
  });
  let result: ActionResult | undefined;
  agent.script(
    Effect.promise(async () => {
      result = await agent.ask({ kind: "describe" });
    }),
  );

  service.prompt("add a synth");
  await flush();

  expect(result).toEqual({ ok: true, text: "Added AMSynth." });
  expect(seen).toEqual([{ turnId: "chain-1", chainId: "chain-1" }]);
});

test("does not show what the agent says outside a turn", async () => {
  start();
  service.prompt("hello");
  await flush();
  const shown = texts();

  agent.say({ type: "message", id: "late", text: "Too late" });
  await flush();

  expect(texts()).toEqual(shown);
});

// --- One at a time --------------------------------------------------------------

test("runs prompts one at a time, in the order they came", async () => {
  start();
  const first = later<void>();
  agent.script(Effect.promise(() => first.promise));

  service.prompt("one");
  service.prompt("two");
  service.prompt("three");
  await flush();

  expect(agent.prompt.mock.calls.map(([text]) => text)).toEqual(["one"]);
  expect(chat()).toMatchObject({ busy: true, queued: 2 });

  first.resolve();
  await flush();

  expect(agent.prompt.mock.calls.map(([text]) => text)).toEqual([
    "one",
    "two",
    "three",
  ]);
  expect(chat()).toMatchObject({ busy: false, queued: 0 });
});

test("Cancel stops the reply and what waits, and the next prompt still runs", async () => {
  start();
  const aborted = vi.fn();
  agent.script(
    Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(aborted))),
  );
  service.prompt("long");
  service.prompt("waiting");
  await flush();

  service.cancel();
  await flush();

  expect(aborted).toHaveBeenCalled();
  expect(chat()).toMatchObject({ busy: false, queued: 0 });
  expect(agent.prompt.mock.calls.map(([text]) => text)).toEqual(["long"]);

  service.prompt("after");
  await flush();
  expect(agent.prompt.mock.calls.map(([text]) => text)).toEqual([
    "long",
    "after",
  ]);
});

test("Cancel while a key is asked for answers it, and the next prompt asks again", async () => {
  localStorage.clear();
  start();
  service.prompt("hello");
  await flush();

  service.cancel();
  await flush();

  expect(chat()).toMatchObject({ keyNeeded: false, busy: false });
  service.prompt("again");
  await flush();
  expect(chat().keyNeeded).toBe(true);
});

test("Cancel while the rack is being checked stops the check, and nothing follows", async () => {
  start();
  let signal: AbortSignal | undefined;
  checkAfterTurn.mockImplementation((given) => {
    signal = given;
    return new Promise(() => undefined);
  });
  service.prompt("hello");
  await flush();

  service.cancel();
  await flush();

  expect(signal?.aborted).toBe(true);
  expect(chat().busy).toBe(false);
  expect(agent.prompt).toHaveBeenCalledTimes(1);
});

// --- Fix-ups --------------------------------------------------------------------

const errors = (fingerprint: string, count = 1): FixupCheck => ({
  _tag: "Errors",
  count,
  fingerprint,
  prompt: `Fix ${fingerprint}`,
});

test("asks the agent to fix errors left after a turn, before any prompt waiting", async () => {
  start();
  const seen: (Turn | undefined)[] = [];
  applyAction.mockImplementation((_, __, turn) => {
    seen.push(turn);
    return { ok: true, text: "Done." };
  });
  checkAfterTurn
    .mockResolvedValueOnce(errors("a", 2))
    .mockResolvedValueOnce({ _tag: "Clean" });
  agent.script(
    Effect.void,
    Effect.promise(async () => {
      await agent.ask({ kind: "check_errors" });
    }),
  );

  service.prompt("build it");
  service.prompt("then this");
  await flush();

  expect(agent.prompt.mock.calls.map(([text]) => text)).toEqual([
    "build it",
    "Fix a",
    "then this",
  ]);
  expect(texts()).toContain(
    "system/notice: Found 2 errors; asking the agent to fix them.",
  );
  expect(seen).toEqual([{ turnId: "chain-1-fix-1", chainId: "chain-1" }]);
});

test("stops when a fix changes nothing about the errors", async () => {
  start();
  checkAfterTurn.mockResolvedValue(errors("same"));

  service.prompt("build it");
  await flush();

  expect(agent.prompt).toHaveBeenCalledTimes(2);
  expect(texts().at(-1)).toBe(
    "system/notice: The last fix changed nothing about the 1 error, so the agent has stopped trying.",
  );
});

test("stops after the most fixes it allows, and says what is left", async () => {
  start({ maxFixups: 2 });
  let round = 0;
  checkAfterTurn.mockImplementation(() =>
    Promise.resolve(errors(`round-${(round += 1)}`)),
  );

  service.prompt("build it");
  await flush();

  expect(agent.prompt).toHaveBeenCalledTimes(3);
  expect(texts().at(-1)).toBe(
    "system/notice: 1 error still left after 2 tries.",
  );
});

test("says so when the rack could not be checked, and asks for no fix-up", async () => {
  start();
  checkAfterTurn.mockResolvedValue({
    _tag: "Unchecked",
    text: "the audio engine is not connected.",
  });

  service.prompt("build it");
  await flush();

  expect(agent.prompt).toHaveBeenCalledTimes(1);
  expect(texts().at(-1)).toBe(
    "system/notice: Could not check the rack for errors: the audio engine is not connected.",
  );
});

test("stops listening once closed", async () => {
  start();
  service.prompt("hello");
  await flush();
  const shown = texts();

  await Effect.runPromise(Scope.close(scope, Exit.void));
  agent.say({ type: "message", id: "after", text: "Still here?" });
  await flush();

  expect(texts()).toEqual(shown);
});

test("shares one key request between prompts that wait on it", async () => {
  localStorage.clear();
  start();
  service.prompt("one");
  service.prompt("two");
  await flush();
  service.submitKey("sk-or-typed");
  await flush();

  expect(createAgent).toHaveBeenCalledTimes(1);
  expect(agent.prompt).toHaveBeenCalledTimes(2);
});
