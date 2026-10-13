import type {
  Agent,
  AgentEvent,
  AgentMessage,
} from "@earendil-works/pi-agent-core";
import { knownApiKey, storeApiKey } from "./key";
import type { ApiKey } from "./types";

// What the chat shows of one message: who said it and the text so far.
export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
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
};

export type SessionOptions = {
  // Called when a prompt needs a key and none is known. Rejecting fails the
  // prompt; the next prompt asks again.
  readonly askForKey: () => Promise<string>;
  // How the agent is made. By default the agent module is loaded on first
  // use, so the model runtime stays out of the initial bundle.
  readonly createAgent?: (apiKey: ApiKey) => Promise<Agent>;
};

let agentModule: Promise<typeof import("./agent")> | undefined;

const loadAgent = async (apiKey: ApiKey): Promise<Agent> => {
  const { createGoodVibesAgent } = await (agentModule ??= import("./agent"));
  return createGoodVibesAgent(apiKey);
};

const messageText = (message: AgentMessage): string => {
  if (message.role !== "user" && message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
};

const messageError = (message: AgentMessage): string | undefined => {
  if (message.role !== "assistant") return undefined;
  if (message.stopReason === "aborted") return "Stopped";
  if (message.stopReason === "error")
    return message.errorMessage ?? "The agent could not reply";
  return undefined;
};

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

  // Kept for this page load in case local storage refuses to save it.
  let enteredKey: string | undefined;
  // Prompts that arrive while the user is being asked share the one answer.
  let pendingKey: Promise<string> | undefined;
  let agent: Promise<Agent> | undefined;
  let running = 0;
  // The message being streamed.
  let streaming: string | undefined;
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

  const onEvent = (event: AgentEvent) => {
    if (event.type === "message_start") {
      const { message } = event;
      if (message.role !== "user" && message.role !== "assistant") return;
      const id = `message-${nextId++}`;
      streaming = id;
      setMessages((list) => [
        ...list,
        { id, role: message.role, text: messageText(message) },
      ]);
      return;
    }

    if (event.type === "message_update" || event.type === "message_end") {
      const id = streaming;
      if (id === undefined) return;
      const text = messageText(event.message);
      const error = messageError(event.message);
      setMessages((list) =>
        list.map((message) =>
          message.id === id ? { ...message, text, error } : message,
        ),
      );
      if (event.type === "message_end") streaming = undefined;
    }
  };

  // Made on the first prompt, once there is a key. The subscription lives as
  // long as the agent, so it needs no unsubscribing. If there is no key, the
  // next prompt tries again.
  const getAgent = (): Promise<Agent> => {
    agent ??= (async () => {
      await apiKey();
      // Read on every request, so a key changed in settings applies at once.
      const created = await createAgent(() => currentKey() ?? "");
      created.subscribe(onEvent);
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
      await ready.prompt(text);
    } finally {
      running -= 1;
      setState({ busy: running > 0 });
    }
  };

  const abort = () => {
    agent?.then((ready) => ready.abort()).catch(() => undefined);
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
  };
};
