import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { Effect, PubSub, Stream, type Scope } from "effect";
import { announced, rackActionsTool, type ApplyAction } from "./tools";
import { PromptError, type ApiKey, type GoodVibesMessage } from "./types";

// Cheap and quick, and it calls tools. It has to be a model pi-ai reaches
// over OpenRouter's chat-completions API: Anthropic models go through its
// Anthropic-style endpoint, whose headers OpenRouter's CORS rejects, so the
// browser cannot call them.
export const goodVibesModelId = "openai/gpt-5.4-mini";

const systemPrompt = `You are the assistant inside Good Vibes, a browser-based modular \
synthesizer where people wire blocks together on a canvas to make sound. Your one \
tool takes a list of actions on the rack. Look at the rack with a describe action \
before changing it: the other actions take their ids from what it says, and it lists \
what the catalogue can add. Put a whole change in one list where you can: add a \
block under an id you choose, then patch it and set its params by that id in the \
same list. After adding or changing blocks, patches or events, end the list with a \
check_errors action, and fix what it reports that you changed before saying you are \
done; mention any other problems rather than changing what the user made. A rack is \
only heard through a Destination block, and only once the user presses Run; you \
cannot start audio yourself. Be warm, brief, and plain-spoken. \
After acting, say what changed in a sentence; otherwise reply in one or two short \
sentences.`;

const models = createModels();
models.setProvider(openrouterProvider());

export const goodVibesModel = () =>
  models.getModel("openrouter", goodVibesModelId);

export type GoodVibesAgent = {
  // Sends one prompt and finishes once the agent has finished replying. The
  // reply itself arrives on `messages`.
  readonly prompt: (text: string) => Effect.Effect<void, PromptError>;
  // Everything the agent says. Each run of the stream is its own listener and
  // sees what is said from then on, so listen before prompting.
  readonly messages: Stream.Stream<GoodVibesMessage>;
  // Stops the running reply; `prompt` then finishes with the text so far.
  readonly abort: Effect.Effect<void>;
};

// The parts of one assistant reply as our messages. `reply` numbers the
// replies so ids stay unique across the conversation.
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

// Runs one agent for as long as the scope is open, so the conversation
// carries over between prompts. Closing the scope ends every listener's
// stream.
export const createGoodVibesAgent = (
  apiKey: ApiKey,
  apply: ApplyAction,
): Effect.Effect<GoodVibesAgent, never, Scope.Scope> =>
  Effect.gen(function* () {
    const model = goodVibesModel();
    if (model === undefined) {
      return yield* Effect.die(
        new Error(`Unknown OpenRouter model ${goodVibesModelId}`),
      );
    }

    const said = yield* Effect.acquireRelease(
      PubSub.unbounded<GoodVibesMessage>(),
      PubSub.shutdown,
    );
    // Each action goes out on `messages` as it is asked for and again once
    // applied, so the chat shows it working.
    const request = announced(
      (message) => PubSub.publishUnsafe(said, message),
      apply,
    );

    // Read per request, see ApiKey.
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools: [rackActionsTool(request)],
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: (provider) =>
        provider === "openrouter" ? apiKey() : undefined,
    });

    let reply = 0;
    const unsubscribe = agent.subscribe((event) => {
      if (event.type === "message_start" && event.message.role === "assistant")
        reply += 1;
      if (event.type !== "message_update" && event.type !== "message_end")
        return;
      for (const message of messagesOf(event.message, reply))
        PubSub.publishUnsafe(said, message);
    });
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    const abort = Effect.sync(() => agent.abort());

    const prompt = (text: string) =>
      Effect.tryPromise({
        try: () => agent.prompt(text),
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
