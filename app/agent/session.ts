import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Effect, Exit, Scope, Stream } from "effect";
import { explainError } from "./explain";
import { clearChat, loadChat, settledTranscript, storeChat } from "./history";
import { knownApiKey, storeApiKey } from "./key";
import type { ApiKey, ChatMessage, GoodVibesMessage, RackStore } from "./types";
import type { GoodVibesAgent } from "./agent";

export type { ChatMessage } from "./types";

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
  // Forgets the conversation, here and in storage, stopping any reply.
  readonly reset: () => void;
  // Remembers a key the user gave: for this page load, and in storage when
  // storage allows. The running agent reads it on its next request.
  readonly setKey: (key: string) => void;
  // Shuts the agent down. Prompts after this fail.
  readonly close: () => Promise<void>;
};

export type CreateAgentOptions = {
  // The model's side of a conversation kept from before a reload.
  readonly history: readonly AgentMessage[];
};

export type CreateAgent = (
  apiKey: ApiKey,
  store: RackStore,
  options: CreateAgentOptions,
) => Effect.Effect<GoodVibesAgent, never, Scope.Scope>;

export type SessionOptions = {
  // Called when a prompt needs a key and none is known. Rejecting fails the
  // prompt; the next prompt asks again.
  readonly askForKey: () => Promise<string>;
  // The store the agent reads the rack from and changes it in.
  readonly store: RackStore;
  // How the agent is made. By default the agent module is loaded on first
  // use, so the model runtime stays out of the initial bundle.
  readonly createAgent?: CreateAgent;
};

let agentModule: Promise<typeof import("./agent")> | undefined;

const loadAgent: CreateAgent = (apiKey, store, options) =>
  Effect.promise(() => (agentModule ??= import("./agent"))).pipe(
    Effect.flatMap(({ createGoodVibesAgent }) =>
      createGoodVibesAgent(apiKey, store, options),
    ),
  );

// Runs one agent for as long as the session lives, so the conversation
// carries over between prompts, and keeps what was said for the chat and in
// this browser's storage, so a reload carries on the same conversation. The
// OpenRouter key comes from the dev server's environment, then from local
// storage, and failing both the session asks for one.
export const createSession = ({
  askForKey,
  store,
  createAgent = loadAgent,
}: SessionOptions): Session => {
  const stored = loadChat();
  let state: SessionState = { messages: stored?.messages ?? [], busy: false };
  // The model's side of the conversation, handed to the agent when it is
  // made, so the two sides match.
  let history: readonly AgentMessage[] = settledTranscript(
    stored?.transcript ?? [],
  );
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
  // Set by abort while a reply runs, so the reply is marked as stopped.
  let stopping = false;
  // Counts resets, so a reply that was running through one does not save
  // the conversation it belonged to over the fresh one.
  let conversation = 0;

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
    const shown: ChatMessage = {
      id,
      role: "assistant",
      kind: said.type,
      text: said.text,
      ...(said.type === "tool"
        ? {
            pending: !said.done,
            args: said.args,
            ...(said.result === undefined ? {} : { result: said.result }),
            ...(said.error === undefined ? {} : { error: said.error }),
          }
        : {}),
    };
    setMessages((list) =>
      list.some((message) => message.id === id)
        ? list.map((message) => (message.id === id ? shown : message))
        : [...list, shown],
    );
  };

  // Shown on the reply that failed, or on its own when nothing arrived.
  const failReply = (raw: string) => {
    const { message: error, recover } = explainError(raw);
    const failure = recover === undefined ? { error } : { error, recover };
    setMessages((list) => {
      const last = list.at(-1);
      if (last?.role === "assistant")
        return [...list.slice(0, -1), { ...last, ...failure }];
      return [
        ...list,
        {
          id: `error-${nextId++}`,
          role: "assistant",
          kind: "message",
          text: "",
          ...failure,
        },
      ];
    });
  };

  const markStopped = () =>
    setMessages((list) => {
      const last = list.at(-1);
      if (last?.role !== "assistant") return list;
      return [...list.slice(0, -1), { ...last, stopped: true }];
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
          const made = yield* createAgent(() => currentKey() ?? "", store, {
            history,
          });
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

  // Keeps the conversation once the agent is quiet, both sides of it.
  const save = async (ready: GoodVibesAgent) => {
    history = settledTranscript(await Effect.runPromise(ready.transcript));
    storeChat({ messages: state.messages, transcript: history });
  };

  const prompt = async (text: string) => {
    running += 1;
    setState({ busy: true });
    const started = conversation;
    let ready: GoodVibesAgent | undefined;
    try {
      ready = await getAgent();
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
      if (stopping && started === conversation) markStopped();
      if (running === 0) stopping = false;
      setState({ busy: running > 0 });
      if (ready !== undefined && running === 0 && started === conversation)
        await save(ready);
    }
  };

  const abort = () => {
    if (running > 0) stopping = true;
    agent
      ?.then((ready) => Effect.runPromise(ready.abort))
      .catch(() => undefined);
  };

  const reset = () => {
    conversation += 1;
    stopping = false;
    history = [];
    setState({ messages: [] });
    clearChat();
    agent
      ?.then((ready) => Effect.runPromise(ready.reset))
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
    reset,
    setKey,
    close,
  };
};
