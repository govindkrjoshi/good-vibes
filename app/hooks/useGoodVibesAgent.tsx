import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Agent,
  AgentEvent,
  AgentMessage,
} from "@earendil-works/pi-agent-core";
import { knownApiKey, storeApiKey } from "../agent-key";
import { ApiKeyDialog } from "../components/api-key-dialog";

// What the chat shows of one message: who said it and the text so far.
export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly error?: string;
};

type PromptOptions = {
  // Sent to the agent but left out of the chat, like the greeting's prompt.
  readonly hidden?: boolean;
};

type GoodVibesAgentContextValue = {
  readonly messages: readonly ChatMessage[];
  // True from a prompt being sent until the agent has finished replying.
  readonly busy: boolean;
  readonly prompt: (text: string, options?: PromptOptions) => Promise<void>;
  readonly abort: () => void;
  readonly changeKey: () => void;
};

const GoodVibesAgentContext = createContext<
  GoodVibesAgentContextValue | undefined
>(undefined);

// Loaded on first use so the model runtime stays out of the initial bundle.
let agentModule: Promise<typeof import("../agent")> | undefined;
const loadAgent = () => (agentModule ??= import("../agent"));

type KeyRequest = {
  readonly promise: Promise<string>;
  readonly resolve: (key: string) => void;
  readonly reject: (error: Error) => void;
};

const keyRequest = (): KeyRequest => {
  let resolve!: (key: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

// Runs one agent in the browser for as long as the provider is mounted, so the
// conversation carries over between prompts, and keeps what was said for the
// chat. The OpenRouter key comes from the dev server's environment, then from
// local storage, and failing both the user is asked for one.
export function GoodVibesAgentProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  // Kept for this page load in case local storage refuses to save it.
  const enteredKey = useRef<string | undefined>(undefined);
  // Prompts that arrive while the user is being asked share the one answer.
  const pending = useRef<KeyRequest | undefined>(undefined);
  const [asking, setAsking] = useState(false);
  // Asked for from settings, so there is no prompt waiting on the answer.
  const [changingKey, setChangingKey] = useState(false);
  const agent = useRef<Promise<Agent> | undefined>(undefined);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([]);
  const [running, setRunning] = useState(0);
  // Hidden prompts still to reach the agent, and the message being streamed.
  const hiddenPrompts = useRef(0);
  const streaming = useRef<string | undefined>(undefined);
  const nextId = useRef(0);

  const currentKey = (): string | undefined =>
    enteredKey.current ?? knownApiKey();

  const apiKey = useCallback((): Promise<string> => {
    const known = currentKey();
    if (known !== undefined) return Promise.resolve(known);

    pending.current ??= keyRequest();
    setAsking(true);
    return pending.current.promise;
  }, []);

  const onEvent = useCallback((event: AgentEvent) => {
    if (event.type === "message_start") {
      const { message } = event;
      if (message.role !== "user" && message.role !== "assistant") return;
      if (message.role === "user" && hiddenPrompts.current > 0) {
        hiddenPrompts.current -= 1;
        streaming.current = undefined;
        return;
      }
      const id = `message-${nextId.current++}`;
      streaming.current = id;
      setMessages((list) => [
        ...list,
        { id, role: message.role, text: messageText(message) },
      ]);
      return;
    }

    if (event.type === "message_update" || event.type === "message_end") {
      const id = streaming.current;
      if (id === undefined) return;
      const text = messageText(event.message);
      const error = messageError(event.message);
      setMessages((list) =>
        list.map((message) =>
          message.id === id ? { ...message, text, error } : message,
        ),
      );
      if (event.type === "message_end") streaming.current = undefined;
    }
  }, []);

  const answer = (settle: (request: KeyRequest) => void) => {
    const request = pending.current;
    pending.current = undefined;
    setAsking(false);
    if (request !== undefined) settle(request);
  };

  // Made on the first prompt, once there is a key. The subscription lives as
  // long as the agent, so it needs no unsubscribing. If there is no key, the
  // next prompt tries again.
  const getAgent = useCallback((): Promise<Agent> => {
    agent.current ??= (async () => {
      await apiKey();
      const { createGoodVibesAgent } = await loadAgent();
      // Read on every request, so a key changed in settings applies at once.
      const created = createGoodVibesAgent(() => currentKey() ?? "");
      created.subscribe(onEvent);
      return created;
    })().catch((error: unknown) => {
      agent.current = undefined;
      throw error;
    });
    return agent.current;
  }, [apiKey, onEvent]);

  const prompt = useCallback(
    async (text: string, { hidden = false }: PromptOptions = {}) => {
      setRunning((count) => count + 1);
      try {
        const ready = await getAgent();
        if (hidden) hiddenPrompts.current += 1;
        await ready.prompt(text);
      } finally {
        setRunning((count) => count - 1);
      }
    },
    [getAgent],
  );

  const abort = useCallback(() => {
    agent.current?.then((ready) => ready.abort()).catch(() => undefined);
  }, []);

  const changeKey = useCallback(() => setChangingKey(true), []);

  const saveKey = (key: string) => {
    enteredKey.current = key;
    storeApiKey(key);
  };

  const value = useMemo(
    () => ({ messages, busy: running > 0, prompt, abort, changeKey }),
    [messages, running, prompt, abort, changeKey],
  );

  return (
    <GoodVibesAgentContext.Provider value={value}>
      {children}
      {asking && (
        <ApiKeyDialog
          onSubmit={(key) => {
            saveKey(key);
            answer((request) => request.resolve(key));
          }}
          onCancel={() =>
            answer((request) =>
              request.reject(new Error("No OpenRouter API key was given")),
            )
          }
        />
      )}
      {changingKey && !asking && (
        <ApiKeyDialog
          onSubmit={(key) => {
            saveKey(key);
            setChangingKey(false);
          }}
          onCancel={() => setChangingKey(false)}
        />
      )}
    </GoodVibesAgentContext.Provider>
  );
}

export const useGoodVibesAgent = (): GoodVibesAgentContextValue => {
  const agent = useContext(GoodVibesAgentContext);
  if (agent === undefined)
    throw new Error(
      "useGoodVibesAgent must be used inside GoodVibesAgentProvider",
    );
  return agent;
};

const greetingPrompt = "Say hello to the user of Good Vibes.";

// Asks the agent for a greeting once per mount; the reply shows in the chat.
// The ref survives React's development-mode effect replay, so Strict Mode
// still greets once.
export function useAgentGreeting() {
  const { prompt } = useGoodVibesAgent();
  const greeted = useRef(false);

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;

    prompt(greetingPrompt, { hidden: true }).catch((error: unknown) =>
      console.warn("Agent greeting failed:", error),
    );
  }, [prompt]);
}
