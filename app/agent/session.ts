import { Effect, Exit, Scope, Stream } from "effect";
import { knownApiKey, storeApiKey } from "./key";
import type { ApiKey, GoodVibesMessage } from "./types";
import type { GoodVibesAgent } from "./agent";

// What the chat shows of one message: who said it and the text so far. The
// agent's thoughts are its reasoning, shown apart from what it says.
export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly kind: "message" | "thought";
  readonly text: string;
  readonly error?: string;
};

export type SessionState = {
  readonly messages: readonly ChatMessage[];
  // True from a prompt being sent until the agent has finished replying.
  readonly busy: boolean;
};

export type Session = {
  readonly getState: () => SessionState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly prompt: (text: string) => Promise<void>;
  readonly abort: () => void;
  // Remembers a key the user gave: for this page load, and in storage when
  // storage allows. The running agent reads it on its next request.
  readonly setKey: (key: string) => void;
  // Shuts the agent down. Prompts after this fail.
  readonly close: () => Promise<void>;
};

export type CreateAgent = (
  apiKey: ApiKey,
) => Effect.Effect<GoodVibesAgent, never, Scope.Scope>;

export type SessionOptions = {
  // Called when a prompt needs a key and none is known. Rejecting fails the
  // prompt; the next prompt asks again.
  readonly askForKey: () => Promise<string>;
  // How the agent is made. By default the agent module is loaded on first
  // use, so the model runtime stays out of the initial bundle.
  readonly createAgent?: CreateAgent;
};

let agentModule: Promise<typeof import("./agent")> | undefined;

const loadAgent: CreateAgent = (apiKey) =>
  Effect.promise(() => (agentModule ??= import("./agent"))).pipe(
    Effect.flatMap(({ createGoodVibesAgent }) => createGoodVibesAgent(apiKey)),
  );

// Runs one agent for as long as the session lives, so the conversation
// carries over between prompts, and keeps what was said for the chat. The
// OpenRouter key comes from the dev server's environment, then from local
// storage, and failing both the session asks for one.
export const createSession = ({
  askForKey,
  createAgent = loadAgent,
}: SessionOptions): Session => {
  let state: SessionState = { messages: [], busy: false };
  const listeners = new Set<() => void>();
  const setState = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const setMessages = (
    update: (messages: readonly ChatMessage[]) => readonly ChatMessage[],
  ) => setState({ messages: update(state.messages) });

  // Owns the agent and the listener on what it says; see close.
  const scope = Effect.runSync(Scope.make());

  // Kept for this page load in case local storage refuses to save it.
  let enteredKey: string | undefined;
  // Prompts that arrive while the user is being asked share the one answer.
  let pendingKey: Promise<string> | undefined;
  let agent: Promise<GoodVibesAgent> | undefined;
  let running = 0;
  let nextId = 0;

  const currentKey = (): string | undefined => enteredKey ?? knownApiKey();

  const setKey = (key: string) => {
    enteredKey = key;
    storeApiKey(key);
  };

  const apiKey = (): Promise<string> => {
    const known = currentKey();
    if (known !== undefined) return Promise.resolve(known);

    pendingKey ??= askForKey()
      .then((key) => {
        setKey(key);
        return key;
      })
      .finally(() => {
        pendingKey = undefined;
      });
    return pendingKey;
  };

  // The agent sends a message again as it grows, so an id already shown is
  // updated in place.
  const onMessage = (said: GoodVibesMessage) => {
    const id = `agent-${said.id}`;
    setMessages((list) =>
      list.some((message) => message.id === id)
        ? list.map((message) =>
            message.id === id ? { ...message, text: said.text } : message,
          )
        : [
            ...list,
            { id, role: "assistant", kind: said.type, text: said.text },
          ],
    );
  };

  // Shown on the reply that failed, or on its own when nothing arrived.
  const failReply = (error: string) =>
    setMessages((list) => {
      const last = list.at(-1);
      if (last?.role === "assistant")
        return [...list.slice(0, -1), { ...last, error }];
      return [
        ...list,
        {
          id: `error-${nextId++}`,
          role: "assistant",
          kind: "message",
          text: "",
          error,
        },
      ];
    });

  // Made on the first prompt, once there is a key. The listener starts
  // before the agent is handed out, so no reply is missed. If there is no
  // key, the next prompt tries again.
  const getAgent = (): Promise<GoodVibesAgent> => {
    agent ??= (async () => {
      await apiKey();
      // Read on every request, so a key changed in settings applies at once.
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const made = yield* createAgent(() => currentKey() ?? "");
          yield* Stream.runForEach(made.messages, (said) =>
            Effect.sync(() => onMessage(said)),
          ).pipe(Effect.forkScoped({ startImmediately: true }));
          return made;
        }).pipe(Scope.provide(scope)),
      );
      return created;
    })().catch((error: unknown) => {
      agent = undefined;
      throw error;
    });
    return agent;
  };

  const prompt = async (text: string) => {
    running += 1;
    setState({ busy: true });
    try {
      const ready = await getAgent();
      setMessages((list) => [
        ...list,
        { id: `user-${nextId++}`, role: "user", kind: "message", text },
      ]);
      await Effect.runPromise(
        ready
          .prompt(text)
          .pipe(
            Effect.catchTag("PromptError", (error) =>
              Effect.sync(() => failReply(error.message)),
            ),
          ),
      );
    } finally {
      running -= 1;
      setState({ busy: running > 0 });
    }
  };

  const abort = () => {
    agent
      ?.then((ready) => Effect.runPromise(ready.abort))
      .catch(() => undefined);
  };

  const close = () =>
    Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt,
    abort,
    setKey,
    close,
  };
};
