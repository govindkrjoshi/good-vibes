import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Effect, Exit, Scope, Stream } from "effect";
import { explainError } from "./explain";
import { settledTranscript } from "./history";
import { knownCredential, storeCredential } from "./key";
import type { Credential } from "./providers";
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
  // Remembers a key the user gave, and the service it is for: for this page
  // load, and in storage when storage allows. The running agent reads it on
  // its next request.
  readonly setKey: (credential: Credential) => void;
  // The key in use, if one is known yet.
  readonly currentKey: () => Credential | undefined;
  // Shuts the agent down. Prompts after this fail.
  readonly close: () => Promise<void>;
};

export type CreateAgentOptions = {
  // The model's side of the open chat's conversation, as kept.
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
  readonly askForKey: () => Promise<Credential>;
  // The store the agent reads the rack from and changes it in.
  readonly store: RackStore;
  // How the agent is made. By default the agent module is loaded on first
  // use, so the model runtime stays out of the initial bundle.
  readonly createAgent?: CreateAgent;
  // Settles once the open chat is loaded into the store. A prompt waits for
  // it, so what it says is not put over by the chat as it loads.
  readonly chatLoaded?: () => Promise<void>;
};

let agentModule: Promise<typeof import("./agent")> | undefined;

const loadAgent: CreateAgent = (apiKey, store, options) =>
  Effect.promise(() => (agentModule ??= import("./agent"))).pipe(
    Effect.flatMap(({ createGoodVibesAgent }) =>
      createGoodVibesAgent(apiKey, store, options),
    ),
  );

// Runs one agent for as long as the session lives, so the conversation
// carries over between prompts. What was said is kept in the store's chat,
// both sides of it, and so in this browser's storage with the rack; opening
// another chat there has the agent carry on that one instead. The key comes
// from the dev server's environment, then from local storage, and failing
// both the session asks for one.
export const createSession = ({
  askForKey,
  store,
  createAgent = loadAgent,
  chatLoaded = () => Promise.resolve(),
}: SessionOptions): Session => {
  let busy = false;
  let state: SessionState = {
    messages: store.getState().chat.messages,
    busy,
  };
  const listeners = new Set<() => void>();
  const notify = () => {
    const { messages } = store.getState().chat;
    if (messages === state.messages && busy === state.busy) return;
    state = { messages, busy };
    for (const listener of listeners) listener();
  };
  const setBusy = (value: boolean) => {
    busy = value;
    notify();
  };
  const setMessages = (
    update: (messages: readonly ChatMessage[]) => readonly ChatMessage[],
  ) => store.getState().chat.setMessages(update);

  // Owns the agent and the listener on what it says; see close.
  const scope = Effect.runSync(Scope.make());

  // Kept for this page load in case local storage refuses to save it.
  let enteredKey: Credential | undefined;
  // Prompts that arrive while the user is being asked share the one answer.
  let pendingKey: Promise<Credential> | undefined;
  let agent: Promise<GoodVibesAgent> | undefined;
  let running = 0;
  let nextId = 0;
  // Set by abort while a reply runs, so the reply is marked as stopped.
  let stopping = false;
  // Counts the chats opened, so a reply that was running when another was
  // opened neither shows nor saves anything in the one opened.
  let conversation = 0;
  // The chat the running reply belongs to.
  let replyingIn = conversation;

  const currentKey = (): Credential | undefined =>
    enteredKey ?? knownCredential();

  const setKey = (credential: Credential) => {
    enteredKey = credential;
    storeCredential(credential);
  };

  const apiKey = (): Promise<Credential> => {
    const known = currentKey();
    if (known !== undefined) return Promise.resolve(known);

    pendingKey ??= askForKey()
      .then((credential) => {
        setKey(credential);
        return credential;
      })
      .finally(() => {
        pendingKey = undefined;
      });
    return pendingKey;
  };

  // The agent sends a message again as it grows, so an id already shown is
  // updated in place.
  const onMessage = (said: GoodVibesMessage) => {
    if (replyingIn !== conversation) return;
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
    if (replyingIn !== conversation) return;
    const { message: error, recover } = explainError(
      raw,
      currentKey()?.provider,
    );
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
      const given = await apiKey();
      // Read on every request, so a key changed in settings applies at once.
      const created = await Effect.runPromise(
        Effect.gen(function* () {
          const made = yield* createAgent(() => currentKey() ?? given, store, {
            history: settledTranscript(store.getState().chat.transcript),
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

  // Keeps the model's side once the agent is quiet, next to the chat's.
  const save = async (ready: GoodVibesAgent, started: number) => {
    const transcript = await Effect.runPromise(ready.transcript);
    if (started !== conversation) return;
    store.getState().chat.setTranscript(settledTranscript(transcript));
  };

  const prompt = async (text: string) => {
    running += 1;
    setBusy(true);
    let started = conversation;
    let ready: GoodVibesAgent | undefined;
    try {
      await chatLoaded();
      started = conversation;
      replyingIn = started;
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
      setBusy(running > 0);
      if (ready !== undefined && running === 0 && started === conversation)
        await save(ready, started);
    }
  };

  const abort = () => {
    if (running > 0) stopping = true;
    agent
      ?.then((ready) => Effect.runPromise(ready.abort))
      .catch(() => undefined);
  };

  // Another chat was opened: the running reply is stopped and belongs to
  // the one left, and the agent carries on the one opened.
  const switched = () => {
    conversation += 1;
    stopping = false;
    agent
      ?.then((ready) =>
        Effect.runPromise(
          ready.restore(settledTranscript(store.getState().chat.transcript)),
        ),
      )
      .catch(() => undefined);
  };

  const unwatch = store.subscribe((next, prev) => {
    if (next.chat.id !== prev.chat.id) switched();
    notify();
  });

  const close = () => {
    unwatch();
    return Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt,
    abort,
    setKey,
    currentKey,
    close,
  };
};
