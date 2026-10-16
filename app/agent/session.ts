import { Effect, Exit, Scope, Stream } from "effect";
import { knownApiKey, storeApiKey } from "./key";
import type {
  ActionStatus,
  ApiKey,
  GoodVibesMessage,
  RackAction,
} from "./types";
import type { GoodVibesAgent } from "./agent";
import type { ApplyAction } from "./tools";

// What the chat shows of one message: who said it and the text so far. The
// agent's thoughts are its reasoning, shown apart from what it says. An
// action is a change the agent asked for: its text says what it is doing
// until it is done, then what came of it.
export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly kind: "message" | "thought" | "action";
  readonly text: string;
  readonly error?: string;
  readonly status?: ActionStatus;
};

// What the chat shows of an action until it has been applied.
export const actionLabel = (action: RackAction): string => {
  switch (action.kind) {
    case "describe":
      return "Looking at the rack";
    case "add_block":
      return `Adding ${action.entry} as ${action.id}`;
    case "remove_blocks":
      return action.blockIds.length === 1
        ? "Removing a block"
        : `Removing ${action.blockIds.length} blocks`;
    case "connect_blocks":
      return "Connecting blocks";
    case "disconnect":
      return "Disconnecting";
    case "set_param":
      return "Setting a param";
    case "set_transport":
      return `Setting the tempo to ${action.bpm} bpm`;
    case "check_errors":
      return "Checking for errors";
    case "retry":
      return `Trying the ${action.entity} ${action.id} again`;
  }
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
  apply: ApplyAction,
) => Effect.Effect<GoodVibesAgent, never, Scope.Scope>;

export type SessionOptions = {
  // Called when a prompt needs a key and none is known. Rejecting fails the
  // prompt; the next prompt asks again.
  readonly askForKey: () => Promise<string>;
  // Makes the change the agent asked for and says what came of it. The
  // agent calls it for each action and waits on it; the agent itself never
  // touches the rack.
  readonly applyAction: ApplyAction;
  // How the agent is made. By default the agent module is loaded on first
  // use, so the model runtime stays out of the initial bundle.
  readonly createAgent?: CreateAgent;
};

let agentModule: Promise<typeof import("./agent")> | undefined;

const loadAgent: CreateAgent = (apiKey, apply) =>
  Effect.promise(() => (agentModule ??= import("./agent"))).pipe(
    Effect.flatMap(({ createGoodVibesAgent }) =>
      createGoodVibesAgent(apiKey, apply),
    ),
  );

// Runs one agent for as long as the session lives, so the conversation
// carries over between prompts, and keeps what was said for the chat. The
// OpenRouter key comes from the dev server's environment, then from local
// storage, and failing both the session asks for one.
export const createSession = ({
  askForKey,
  applyAction,
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

  // The agent sends a message again as it grows or settles, so an id already
  // shown is replaced in place.
  const upsert = (message: ChatMessage) =>
    setMessages((list) =>
      list.some((held) => held.id === message.id)
        ? list.map((held) => (held.id === message.id ? message : held))
        : [...list, message],
    );

  const actionRow = (
    said: GoodVibesMessage & { type: "action" },
  ): ChatMessage => {
    const shared = {
      id: `agent-${said.id}`,
      role: "assistant",
      kind: "action",
    } as const;
    const label = actionLabel(said.action);
    switch (said.status) {
      case "requested":
        return { ...shared, text: label, status: "requested" };
      case "done":
        return { ...shared, text: said.result?.text ?? label, status: "done" };
      case "failed":
        return {
          ...shared,
          text: label,
          status: "failed",
          error: said.result?.text ?? "The change could not be made",
        };
    }
  };

  const onMessage = (said: GoodVibesMessage) => {
    if (said.type === "action") {
      upsert(actionRow(said));
      return;
    }
    upsert({
      id: `agent-${said.id}`,
      role: "assistant",
      kind: said.type,
      text: said.text,
    });
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
          const made = yield* createAgent(
            () => currentKey() ?? "",
            applyAction,
          );
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
