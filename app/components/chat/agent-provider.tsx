import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { applyAction } from "../../actions";
import { createSession, type ChatMessage } from "../../agent";
import { rackStore } from "../../rack";
import { ApiKeyDialog } from "./api-key-dialog";

export type { ChatMessage } from "../../agent";

type GoodVibesAgentContextValue = {
  readonly messages: readonly ChatMessage[];
  // True from a prompt being sent until the agent has finished replying.
  readonly busy: boolean;
  readonly prompt: (text: string) => Promise<void>;
  readonly abort: () => void;
  readonly changeKey: () => void;
};

const GoodVibesAgentContext = createContext<
  GoodVibesAgentContextValue | undefined
>(undefined);

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

// Runs one agent session in the browser for as long as the provider is
// mounted, shows the key dialog whenever the session asks for one, and makes
// the changes the agent asks for on the rack store.
export function GoodVibesAgentProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  // The session's open request for a key, while the user is being asked.
  const [request, setRequest] = useState<KeyRequest | undefined>(undefined);
  // Asked for from settings, so there is no prompt waiting on the answer.
  const [changingKey, setChangingKey] = useState(false);
  const [session] = useState(() =>
    createSession({
      askForKey: () => {
        const asked = keyRequest();
        setRequest(asked);
        return asked.promise;
      },
      applyAction: (action) => applyAction(rackStore, action),
    }),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );

  const answer = (settle: (request: KeyRequest) => void) => {
    setRequest(undefined);
    if (request !== undefined) settle(request);
  };

  const changeKey = useCallback(() => setChangingKey(true), []);

  const value = useMemo(
    () => ({
      messages: state.messages,
      busy: state.busy,
      prompt: session.prompt,
      abort: session.abort,
      changeKey,
    }),
    [state, session, changeKey],
  );

  return (
    <GoodVibesAgentContext.Provider value={value}>
      {children}
      {request !== undefined && (
        <ApiKeyDialog
          onSubmit={(key) => answer((asked) => asked.resolve(key))}
          onCancel={() =>
            answer((asked) =>
              asked.reject(new Error("No OpenRouter API key was given")),
            )
          }
        />
      )}
      {changingKey && request === undefined && (
        <ApiKeyDialog
          onSubmit={(key) => {
            session.setKey(key);
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
