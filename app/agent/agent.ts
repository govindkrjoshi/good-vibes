import {
  Agent,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Effect, PubSub, Stream, type Scope } from "effect";
import {
  codeHelp,
  createErrorWatch,
  createRackTools,
  patchRule,
} from "./tools";
import {
  PromptError,
  type ApiKey,
  type GoodVibesMessage,
  type RackStore,
} from "./types";

// Cheap and quick. It has to be a model pi-ai reaches over OpenRouter's
// chat-completions API: Anthropic models go through its Anthropic-style
// endpoint, whose headers OpenRouter's CORS rejects, so the browser cannot
// call them.
export const goodVibesModelId = "openai/gpt-5.4-mini";

export const systemPrompt = `You are the assistant inside Good Vibes, a browser-based modular \
synthesizer where people wire racks together on a canvas to make sound. You can read the rack \
and change it with your tools, the same changes the user makes by hand. Be warm, brief and \
plain-spoken: a sentence or two around what you did, no lists of ids unless asked.

How the rack works:
- The rack is a tree. The root is a tree; a tree (group) holds leaves and other trees. A leaf \
is one Tone.js node made by its code, with params, jacks, methods and events.
- Ids: a rack has a short id. Its jacks are rack:in, rack:out, rack:in:key or rack:out:key, \
and a patchable param's jack is rack:mod:path. Its params are rack:param:path, its methods \
rack:method:name. read_rack shows them all.
- ${patchRule}
- Sound reaches the speakers only through a Destination rack (tone/Destination); events and \
automations only play while the transport is playing. The user hears the rack as it is now.
- A param with a patch into its mod jack follows that signal; its own value waits.
- Times are seconds (0.5), note lengths (4n, 8t, 1m) or bars:beats:sixteenths (1:2:0).

How to work:
- Read before you change: read_rack for what is there, read_catalogue to find an item or see \
its param paths. Use the ids you were shown; never guess one.
- Prefer a catalogue item. When none does what is needed, write a rack of your own with \
create_rack, starting from a similar item's spec (read_catalogue with withCode). Keep the \
code small and the params to what the node's set() accepts.
- After changing a rack, the sandbox builds it and may report a problem back to you: a param \
path the node lacks, code that fails. Fix it with update_rack or set the right path. Say \
what went wrong when you can't.
- Don't clear the rack or load a demo unless asked. Don't start the transport unless asked \
or the user clearly wants to hear it.

Leaf code: ${codeHelp}`;

const models = createModels();
models.setProvider(openrouterProvider());

export const goodVibesModel = () =>
  models.getModel("openrouter", goodVibesModelId);

export type GoodVibesAgent = {
  // Sends one prompt and finishes once the agent has finished replying. The
  // reply itself arrives on `messages`.
  readonly prompt: (text: string) => Effect.Effect<void, PromptError>;
  // Everything the agent says and does. Each run of the stream is its own
  // listener and sees what is said from then on, so listen before prompting.
  readonly messages: Stream.Stream<GoodVibesMessage>;
  // Stops the running reply; `prompt` then finishes with the text so far.
  readonly abort: Effect.Effect<void>;
};

// The parts of one assistant reply as our messages. `reply` numbers the
// replies so ids stay unique across the conversation. Tool calls are told
// apart as they run, not here.
export const messagesOf = (
  message: AgentMessage,
  reply: number,
): GoodVibesMessage[] => {
  if (message.role !== "assistant") return [];
  return message.content.flatMap((part, index): GoodVibesMessage[] => {
    const id = `${reply}-${index}`;
    if (part.type === "text") return [{ type: "message", id, text: part.text }];
    if (part.type === "thinking")
      return [{ type: "thought", id, text: part.thinking }];
    return [];
  });
};

// What the rack reported after the agent's last action, as a message to it.
export const errorNote = (errors: readonly string[]): AgentMessage => ({
  role: "user",
  content: [
    {
      type: "text",
      text: `The rack reported since your last action:\n${errors
        .map((error) => `- ${error}`)
        .join("\n")}`,
    },
  ],
  timestamp: Date.now(),
});

// Another model and way of reaching it, for tests that script the replies.
export type AgentOverrides = {
  readonly model?: Model<Api>;
  readonly streamFn?: StreamFn;
};

// Runs one agent for as long as the scope is open, so the conversation
// carries over between prompts. Closing the scope ends every listener's
// stream.
export const createGoodVibesAgent = (
  apiKey: ApiKey,
  store: RackStore,
  overrides: AgentOverrides = {},
): Effect.Effect<GoodVibesAgent, never, Scope.Scope> =>
  Effect.gen(function* () {
    const model = overrides.model ?? goodVibesModel();
    if (model === undefined) {
      return yield* Effect.die(
        new Error(`Unknown OpenRouter model ${goodVibesModelId}`),
      );
    }

    const watch = createErrorWatch(store);
    const tools = createRackTools(store, watch);
    const labels = new Map(tools.map((tool) => [tool.name, tool.label]));

    // Read per request, see ApiKey.
    const agent = new Agent({
      initialState: { systemPrompt, model, tools },
      streamFn: overrides.streamFn ?? models.streamSimple.bind(models),
      getApiKey: (provider) =>
        provider === "openrouter" ? apiKey() : undefined,
      // "Add, then connect" in one reply has to run in that order.
      toolExecution: "sequential",
    });

    const said = yield* Effect.acquireRelease(
      PubSub.unbounded<GoodVibesMessage>(),
      PubSub.shutdown,
    );
    const say = (message: GoodVibesMessage) =>
      PubSub.publishUnsafe(said, message);

    let reply = 0;
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant")
        reply += 1;
      if (event.type === "tool_execution_start") {
        say({
          type: "tool",
          id: `tool-${event.toolCallId}`,
          text: `${labels.get(event.toolName) ?? event.toolName}…`,
          done: false,
        });
      }
      if (event.type === "tool_execution_end") {
        const result = event.result as {
          details?: { summary?: string };
          content?: { type: string; text?: string }[];
        };
        const text =
          result.details?.summary ??
          labels.get(event.toolName) ??
          event.toolName;
        say({
          type: "tool",
          id: `tool-${event.toolCallId}`,
          text,
          done: true,
          ...(event.isError
            ? {
                error:
                  result.content?.find((part) => part.type === "text")?.text ??
                  text,
              }
            : {}),
        });
      }
      if (event.type !== "message_update" && event.type !== "message_end")
        return;
      for (const message of messagesOf(event.message, reply)) say(message);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    // What the rack reports once a change reaches the sandbox arrives after
    // the tool that made it has returned. It is told to the agent on its next
    // turn, or with the next prompt once it has stopped. A tool's own
    // failures are taken by the tool, so they don't come round twice.
    let pending: string[] = [];
    const unwatch = store.subscribe(() => {
      queueMicrotask(() => {
        const fresh = watch.take();
        if (fresh.length === 0) return;
        if (agent.state.isStreaming) agent.steer(errorNote(fresh));
        else pending.push(...fresh);
      });
    });
    yield* Effect.addFinalizer(() => Effect.sync(unwatch));

    const abort = Effect.sync(() => agent.abort());

    const prompt = (text: string) =>
      Effect.tryPromise({
        try: () => {
          const asked: AgentMessage = {
            role: "user",
            content: text,
            timestamp: Date.now(),
          };
          const notes = pending.length === 0 ? [] : [errorNote(pending)];
          pending = [];
          return agent.prompt([...notes, asked]);
        },
        catch: (error) =>
          new PromptError({
            message:
              error instanceof Error
                ? error.message
                : "The agent could not reply",
          }),
      }).pipe(
        Effect.flatMap(() => {
          // pi-agent-core reports a failed request on the reply rather than
          // by rejecting, so look there.
          const last = agent.state.messages.at(-1);
          if (last?.role === "assistant" && last.stopReason === "error") {
            return Effect.fail(
              new PromptError({
                message: last.errorMessage ?? "The agent could not reply",
              }),
            );
          }
          return Effect.void;
        }),
        // Interrupting the prompt stops the reply too.
        Effect.onInterrupt(() => abort),
      );

    return { prompt, messages: Stream.fromPubSub(said), abort };
  });
