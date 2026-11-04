import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Message,
} from "@earendil-works/pi-ai";
import { Effect, Exit, Scope, Stream } from "effect";
import { beforeEach, expect, test } from "vitest";
import { useStore } from "../stores";
import { createGoodVibesAgent, goodVibesModel, messagesOf } from "./agent";
import type { GoodVibesMessage } from "./types";

// An agent whose replies are scripted, running against the real store and
// the real tools. What it says is collected until the scope closes.
const scripted = async (
  replies: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  run: (prompt: (text: string) => Promise<void>) => Promise<void>,
) => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(replies);
  const scope = Effect.runSync(Scope.make());
  const said: GoodVibesMessage[] = [];
  const agent = await Effect.runPromise(
    Effect.gen(function* () {
      const made = yield* createGoodVibesAgent(() => credential, useStore, {
        model: faux.getModel(),
        streamFn: models.streamSimple.bind(models),
      });
      yield* Stream.runForEach(made.messages, (message) =>
        Effect.sync(() => said.push(message)),
      ).pipe(Effect.forkScoped({ startImmediately: true }));
      return made;
    }).pipe(Scope.provide(scope)),
  );
  try {
    await run((text) => Effect.runPromise(agent.prompt(text)));
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
  }
  return said;
};

const texts = (messages: Message[]) =>
  messages.flatMap((message) => {
    if (message.role !== "user") return [];
    if (typeof message.content === "string") return [message.content];
    return message.content.flatMap((part) =>
      part.type === "text" ? [part.text] : [],
    );
  });

const credential = { provider: "openrouter", key: "key" } as const;

const initial = useStore.getState();
beforeEach(() => {
  useStore.setState(initial, true);
});

test("uses a model the browser can reach through OpenRouter's CORS", () => {
  expect(goodVibesModel("openrouter")).toMatchObject({
    provider: "openrouter",
    api: "openai-completions",
  });
});

test("has a model on each service a key can be for", () => {
  expect(goodVibesModel("anthropic")).toMatchObject({
    provider: "anthropic",
    api: "anthropic-messages",
  });
  expect(goodVibesModel("openai")).toMatchObject({
    provider: "openai",
    api: "openai-responses",
  });
});

test("turns a reply's text into messages and keeps its thinking to itself", () => {
  const reply = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "They said hello." },
      { type: "toolCall", id: "call", name: "noop", arguments: {} },
      { type: "text", text: "Hi there" },
    ],
  } as AgentMessage;

  expect(messagesOf(reply, 3)).toEqual([
    { type: "message", id: "3-2", text: "Hi there" },
  ]);
});

test("has nothing to say for what the user sent", () => {
  expect(
    messagesOf({ role: "user", content: "hello" } as AgentMessage, 1),
  ).toEqual([]);
});

test("acts on the rack with its tools and tells the chat what it did", async () => {
  const said = await scripted(
    [
      fauxAssistantMessage([
        fauxToolCall(
          "add_rack",
          { item: "tone/MonoSynth", id: "bass" },
          { id: "c1" },
        ),
        fauxToolCall(
          "connect",
          { from: "bass:out", to: "out:in" },
          { id: "c2" },
        ),
      ]),
      fauxAssistantMessage(
        "Added a bass, but there is nothing to patch it into.",
      ),
    ],
    async (prompt) => {
      await prompt("add a bass");
    },
  );

  expect(useStore.getState().rack.racks.bass).toMatchObject({
    name: "MonoSynth",
  });
  expect(said.filter((message) => message.type === "tool")).toEqual([
    {
      type: "tool",
      id: "tool-c1",
      text: "Adding a rack…",
      done: false,
      args: { item: "tone/MonoSynth", id: "bass" },
    },
    {
      type: "tool",
      id: "tool-c1",
      text: "Added [bass] MonoSynth from tone/MonoSynth in root.",
      done: true,
      args: { item: "tone/MonoSynth", id: "bass" },
      result: expect.stringContaining("Added [bass] MonoSynth"),
    },
    {
      type: "tool",
      id: "tool-c2",
      text: "Patching…",
      done: false,
      args: { from: "bass:out", to: "out:in" },
    },
    {
      type: "tool",
      id: "tool-c2",
      text: "Patching failed",
      done: true,
      args: { from: "bass:out", to: "out:in" },
      result: expect.stringContaining("There is no jack out:in"),
      error: expect.stringContaining("There is no jack out:in"),
    },
  ]);
  expect(said.at(-1)).toEqual({
    type: "message",
    id: "2-0",
    text: "Added a bass, but there is nothing to patch it into.",
  });
});

test("says what it is about to do, apart from what it does", async () => {
  const said = await scripted(
    [
      fauxAssistantMessage([
        fauxToolCall("brief", { text: "I'll add a bass." }, { id: "b1" }),
        fauxToolCall(
          "add_rack",
          { item: "tone/MonoSynth", id: "bass" },
          { id: "c1" },
        ),
      ]),
      fauxAssistantMessage("There's your bass."),
    ],
    async (prompt) => {
      await prompt("add a bass");
    },
  );

  // The reply's words stream in over several messages of the same id.
  expect([...new Set(said.map((message) => message.type))]).toEqual([
    "brief",
    "tool",
    "message",
  ]);
  expect(said[0]).toEqual({
    type: "brief",
    id: "brief-b1",
    text: "I'll add a bass.",
  });
});

test("carries on a kept conversation and says it was reopened", async () => {
  let heard: string[] = [];
  const history: AgentMessage[] = [
    { role: "user", content: "hi", timestamp: 1 },
    fauxAssistantMessage("Hello."),
  ];
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    (context) => {
      heard = texts(context.messages);
      return fauxAssistantMessage("Still here.");
    },
  ]);
  const scope = Effect.runSync(Scope.make());
  const agent = await Effect.runPromise(
    createGoodVibesAgent(() => credential, useStore, {
      model: faux.getModel(),
      streamFn: models.streamSimple.bind(models),
      history,
    }).pipe(Scope.provide(scope)),
  );
  try {
    await Effect.runPromise(agent.prompt("what's there?"));
    const transcript = await Effect.runPromise(agent.transcript);

    expect(heard).toEqual([
      "hi",
      expect.stringContaining("This conversation has been reopened"),
      "what's there?",
    ]);
    expect(heard[1]).toContain("Transport: 120 bpm, stopped.");
    expect(transcript.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "user",
      "assistant",
    ]);

    await Effect.runPromise(agent.reset);
    expect(await Effect.runPromise(agent.transcript)).toEqual([]);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
  }
});

test("carries on another conversation in place of this one", async () => {
  let heard: string[] = [];
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage("First."),
    (context) => {
      heard = texts(context.messages);
      return fauxAssistantMessage("Back again.");
    },
  ]);
  const scope = Effect.runSync(Scope.make());
  const agent = await Effect.runPromise(
    createGoodVibesAgent(() => credential, useStore, {
      model: faux.getModel(),
      streamFn: models.streamSimple.bind(models),
    }).pipe(Scope.provide(scope)),
  );
  try {
    await Effect.runPromise(agent.prompt("one chat"));
    await Effect.runPromise(
      agent.restore([
        { role: "user", content: "another chat", timestamp: 1 },
        fauxAssistantMessage("Hello."),
      ]),
    );
    await Effect.runPromise(agent.prompt("what's there?"));

    expect(heard).toEqual([
      "another chat",
      expect.stringContaining("This conversation has been reopened"),
      "what's there?",
    ]);
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
  }
});

test("hears what the rack reports after its change, on its next turn", async () => {
  // Stands in for the sandbox: once the rack has a bass, it complains, a
  // moment after the tool that added it has returned.
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (
      state.rack.racks.bass !== undefined &&
      prev.rack.racks.bass === undefined
    ) {
      queueMicrotask(() => state.rack.reportError("Bass can't be built: no"));
    }
  });
  let heard: string[] = [];
  try {
    await scripted(
      [
        fauxAssistantMessage([
          fauxToolCall("add_rack", { item: "tone/MonoSynth", id: "bass" }),
        ]),
        (context) => {
          heard = texts(context.messages);
          return fauxAssistantMessage("I'll look at that.");
        },
      ],
      async (prompt) => {
        await prompt("add a bass");
      },
    );
  } finally {
    unsubscribe();
  }

  expect(heard.at(-1)).toBe(
    "The rack reported since your last action:\n- Bass can't be built: no",
  );
});

test("carries what the rack reported while idle into the next prompt", async () => {
  let heard: string[] = [];
  await scripted(
    [
      fauxAssistantMessage("Hello."),
      (context) => {
        heard = texts(context.messages);
        return fauxAssistantMessage("Noted.");
      },
    ],
    async (prompt) => {
      await prompt("hi");
      useStore.getState().rack.reportError("Echo can't be patched");
      await new Promise((resolve) => setTimeout(resolve, 0));
      await prompt("anything wrong?");
    },
  );

  expect(heard.slice(-2)).toEqual([
    "The rack reported since your last action:\n- Echo can't be patched",
    "anything wrong?",
  ]);
});
