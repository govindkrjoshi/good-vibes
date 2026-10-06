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
import { knownApiKey, storeApiKey } from "../agent-key";
import { ApiKeyDialog } from "../components/api-key-dialog";

type GoodVibesAgentContextValue = {
  readonly prompt: (text: string) => Promise<string>;
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

// Runs the agent in the browser. The OpenRouter key comes from the dev
// server's environment, then from local storage, and failing both the user is
// asked for one.
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

  const apiKey = useCallback((): Promise<string> => {
    const known = knownApiKey() ?? enteredKey.current;
    if (known !== undefined) return Promise.resolve(known);

    pending.current ??= keyRequest();
    setAsking(true);
    return pending.current.promise;
  }, []);

  const answer = (settle: (request: KeyRequest) => void) => {
    const request = pending.current;
    pending.current = undefined;
    setAsking(false);
    if (request !== undefined) settle(request);
  };

  const value = useMemo(
    () => ({
      prompt: async (text: string) => {
        const key = await apiKey();
        const { runGoodVibesAgent } = await loadAgent();
        return runGoodVibesAgent(text, key);
      },
    }),
    [apiKey],
  );

  return (
    <GoodVibesAgentContext.Provider value={value}>
      {children}
      {asking && (
        <ApiKeyDialog
          onSubmit={(key) => {
            enteredKey.current = key;
            storeApiKey(key);
            answer((request) => request.resolve(key));
          }}
          onCancel={() =>
            answer((request) =>
              request.reject(new Error("No OpenRouter API key was given")),
            )
          }
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

// Asks the agent for a greeting once per mount and logs it. The ref survives
// React's development-mode effect replay, so Strict Mode still greets once.
export function useAgentGreeting() {
  const { prompt } = useGoodVibesAgent();
  const greeted = useRef(false);

  useEffect(() => {
    if (greeted.current) return;
    greeted.current = true;

    prompt(greetingPrompt).then(
      (reply) => console.log(reply),
      (error: unknown) => console.warn("Agent greeting failed:", error),
    );
  }, [prompt]);
}
