import {
  Agent,
  type AgentMessage,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import { createModels, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Effect, PubSub, Stream, type Scope } from "effect";
import {
  codeHelp,
  createErrorWatch,
  createRackTools,
  describeRackTree,
  patchRule,
} from "./tools";
import { providerOf, type ProviderId } from "./providers";
import {
  PromptError,
  type ApiKey,
  type GoodVibesMessage,
  type RackStore,
} from "./types";

export const systemPrompt = `You are the assistant inside Good Vibes, a browser-based modular \
synthesizer where people wire racks together on a canvas to make sound. You can read the rack \
and change it with your tools, the same changes the user makes by hand. Be warm, brief and \
plain-spoken, and no lists of ids unless asked.

Work in small, visible steps. The user watches the rack change as you go, so:
- Before each step, call brief with one sentence on what you're about to do, then do it in \
the same reply; then the next step. Your reasoning is never shown, so brief is how the user \
follows along. Keep your text for talking to the user: an answer, a question, or what's \
there when you've finished.
- Make a few changes at a time rather than everything in one go: place a rack, then patch it, \
then set its sound. Each step should leave the rack in a state that makes sense on its own.
- Keep every message to a sentence or two. When you've finished, one line on what's there \
now and, if it fits, one thing they could try next.

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
its param paths. One read is usually enough: search the catalogue once with a few words, and \
read an item in full only when you need its param paths. Use the ids you were shown; never \
guess one.
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
models.setProvider(anthropicProvider());
models.setProvider(openaiProvider());

// The model the agent uses on a service; see ./providers.
export const goodVibesModel = (provider: ProviderId) =>
  models.getModel(provider, providerOf(provider).modelId);

export type GoodVibesAgent = {
  // Sends one prompt and finishes once the agent has finished replying. The
  // reply itself arrives on `messages`.
  readonly prompt: (text: string) => Effect.Effect<void, PromptError>;
  // Everything the agent says and does. Each run of the stream is its own
  // listener and sees what is said from then on, so listen before prompting.
  readonly messages: Stream.Stream<GoodVibesMessage>;
  // Stops the running reply; `prompt` then finishes with the text so far.
  readonly abort: Effect.Effect<void>;
  // The conversation as the model has it, without the system prompt, for
  // keeping and handing back as `history`.
  readonly transcript: Effect.Effect<readonly AgentMessage[]>;
  // Forgets the conversation, stopping a running reply first.
  readonly reset: Effect.Effect<void>;
  // Carries on another conversation in place of this one, stopping a
  // running reply first, as when the user opens another chat.
  readonly restore: (history: readonly AgentMessage[]) => Effect.Effect<void>;
};

// The parts of one assistant reply as our messages. `reply` numbers the
// replies so ids stay unique across the conversation. Tool calls are told
// apart as they run, not here, and the model's thinking is left out: the
// chat never shows it.
export const messagesOf = (
  message: AgentMessage,
  reply: number,
): GoodVibesMessage[] => {
  if (message.role !== "assistant") return [];
  return message.content.flatMap((part, index): GoodVibesMessage[] => {
    const id = `${reply}-${index}`;
    if (part.type === "text") return [{ type: "message", id, text: part.text }];
    return [];
  });
};

// Told to the agent when it carries on a conversation it was not in the
// middle of: after a reload, or on opening a chat again. The rack is kept
// with the chat and restored with it, but may differ from what the agent
// remembers, so here is the rack as it is now.
export const reloadNote = (store: RackStore): AgentMessage => ({
  role: "user",
  content: [
    {
      type: "text",
      text: `This conversation has been reopened since your last reply. Its rack was kept \
with it and has been restored, but check it rather than going on memory. Here it is now:\n\
${describeRackTree(store.getState().rack)}`,
    },
  ],
  timestamp: Date.now(),
});

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

export type AgentOptions = {
  // The conversation so far, from before a reload, for the agent to carry
  // on from. It is told the page reloaded with its next prompt.
  readonly history?: readonly AgentMessage[];
  // Another model and way of reaching it, for tests that script the replies.
  // It is kept whichever service the key is for.
  readonly model?: Model<Api>;
  readonly streamFn?: StreamFn;
};

// Runs one agent for as long as the scope is open, so the conversation
// carries over between prompts. Closing the scope ends every listener's
// stream.
export const createGoodVibesAgent = (
  apiKey: ApiKey,
  store: RackStore,
  options: AgentOptions = {},
): Effect.Effect<GoodVibesAgent, never, Scope.Scope> =>
  Effect.gen(function* () {
    // The model for the service the key is for, made again when the user
    // switches to a key for another. pi-ai carries the conversation across.
    const modelFor = (provider: ProviderId): Model<Api> => {
      if (options.model !== undefined) return options.model;
      const model = goodVibesModel(provider);
      if (model === undefined)
        throw new Error(
          `Unknown ${provider} model ${providerOf(provider).modelId}`,
        );
      return model;
    };

    const watch = createErrorWatch(store);
    const tools = createRackTools(store, watch);
    const labels = new Map(tools.map((tool) => [tool.name, tool.label]));

    // Read per request, see ApiKey.
    const agent = new Agent({
      // GLM reasons at length when left to itself, and a turn here is a few
      // tool calls, not a proof. Low keeps it thinking but briefly; "off"
      // sends it nothing, so it would go back to its default.
      initialState: {
        systemPrompt,
        model: modelFor(apiKey().provider),
        tools,
        thinkingLevel: "low",
        messages: [...(options.history ?? [])],
      },
      streamFn: options.streamFn ?? models.streamSimple.bind(models),
      getApiKey: (provider) => {
        const credential = apiKey();
        return provider === credential.provider ? credential.key : undefined;
      },
      // "Add, then connect" in one reply has to run in that order.
      toolExecution: "sequential",
    });

    const said = yield* Effect.acquireRelease(
      PubSub.unbounded<GoodVibesMessage>(),
      PubSub.shutdown,
    );
    const say = (message: GoodVibesMessage) =>
      PubSub.publishUnsafe(said, message);

    const argsOf = (args: unknown): Readonly<Record<string, unknown>> =>
      typeof args === "object" && args !== null
        ? (args as Record<string, unknown>)
        : {};
    // What each running tool was asked, for the message that says it is done.
    const asked = new Map<string, Readonly<Record<string, unknown>>>();

    let reply = 0;
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant")
        reply += 1;
      if (event.type === "tool_execution_start") {
        const args = argsOf(event.args);
        if (event.toolName === "brief") {
          say({
            type: "brief",
            id: `brief-${event.toolCallId}`,
            text: String(args.text ?? ""),
          });
          return;
        }
        asked.set(event.toolCallId, args);
        say({
          type: "tool",
          id: `tool-${event.toolCallId}`,
          text: `${labels.get(event.toolName) ?? event.toolName}…`,
          done: false,
          args,
        });
      }
      if (event.type === "tool_execution_end") {
        if (event.toolName === "brief") return;
        const result = event.result as {
          details?: { summary?: string };
          content?: { type: string; text?: string }[];
        };
        const reported = (result.content ?? [])
          .flatMap((part) =>
            part.type === "text" && part.text !== undefined ? [part.text] : [],
          )
          .join("\n");
        const text =
          result.details?.summary ??
          labels.get(event.toolName) ??
          event.toolName;
        const args = asked.get(event.toolCallId) ?? {};
        asked.delete(event.toolCallId);
        say({
          type: "tool",
          id: `tool-${event.toolCallId}`,
          text,
          done: true,
          args,
          result: reported,
          ...(event.isError
            ? { error: reported === "" ? text : reported }
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

    // Until its first prompt, an agent handed a history has yet to hear
    // that the page reloaded.
    let resumed = (options.history?.length ?? 0) > 0;

    const prompt = (text: string) =>
      Effect.tryPromise({
        try: () => {
          const asked: AgentMessage = {
            role: "user",
            content: text,
            timestamp: Date.now(),
          };
          const notes = [
            ...(resumed ? [reloadNote(store)] : []),
            ...(pending.length === 0 ? [] : [errorNote(pending)]),
          ];
          resumed = false;
          pending = [];
          agent.state.model = modelFor(apiKey().provider);
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

    const transcript = Effect.sync(() =>
      agent.state.messages.filter((message) => message.role !== "system"),
    );

    const restore = (history: readonly AgentMessage[]) =>
      Effect.promise(async () => {
        agent.abort();
        await agent.waitForIdle();
        agent.reset();
        // Reset keeps the system prompt; the history goes after it.
        agent.state.messages = [...agent.state.messages, ...history];
        pending = [];
        resumed = history.length > 0;
      });

    const reset = restore([]);

    return {
      prompt,
      messages: Stream.fromPubSub(said),
      abort,
      transcript,
      reset,
      restore,
    };
  });
