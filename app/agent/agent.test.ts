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
      const made = yield* createGoodVibesAgent(() => "key", useStore, {
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

const initial = useStore.getState();
beforeEach(() => {
  useStore.setState(initial, true);
});

test("uses a model the browser can reach through OpenRouter's CORS", () => {
  expect(goodVibesModel()).toMatchObject({
    provider: "openrouter",
    api: "openai-completions",
  });
});

test("turns a reply's parts into thoughts and messages", () => {
  const reply = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "They said hello." },
      { type: "toolCall", id: "call", name: "noop", arguments: {} },
      { type: "text", text: "Hi there" },
    ],
  } as AgentMessage;

  expect(messagesOf(reply, 3)).toEqual([
    { type: "thought", id: "3-0", text: "They said hello." },
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
    { type: "tool", id: "tool-c1", text: "Adding a rack…", done: false },
    {
      type: "tool",
      id: "tool-c1",
      text: "Added [bass] MonoSynth from tone/MonoSynth in root.",
      done: true,
    },
    { type: "tool", id: "tool-c2", text: "Patching…", done: false },
    {
      type: "tool",
      id: "tool-c2",
      text: "Patching failed",
      done: true,
      error: expect.stringContaining("There is no jack out:in"),
    },
  ]);
  expect(said.at(-1)).toEqual({
    type: "message",
    id: "2-0",
    text: "Added a bass, but there is nothing to patch it into.",
  });
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
