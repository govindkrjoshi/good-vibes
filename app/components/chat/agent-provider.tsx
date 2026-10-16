import { Effect, Exit, Scope } from "effect";
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
import { createStore, useStore } from "zustand";
import { applyAction, checkAfterTurn, type ActionDeps } from "../../actions";
import {
  initialChatState,
  makeAgentService,
  type AgentService,
  type ChatMessage,
  type ChatState,
} from "../../agent";
import { rackStore } from "../../rack";
import { sandboxStatus } from "../../sandbox";
import { useSandboxClient } from "../sandbox/sandbox-provider";
import { ApiKeyDialog } from "./api-key-dialog";

export type { ChatMessage } from "../../agent";

type GoodVibesAgentContextValue = {
  readonly messages: readonly ChatMessage[];
  // True while a prompt runs or waits to.
  readonly busy: boolean;
  // Prompts sent while the agent was busy, waiting their turn.
  readonly queued: number;
  readonly prompt: (text: string) => void;
  // Stops the reply, its fix-ups, and everything waiting.
  readonly abort: () => void;
  readonly changeKey: () => void;
};

const GoodVibesAgentContext = createContext<
  GoodVibesAgentContextValue | undefined
>(undefined);

// A chat with no service yet, as on the server and before the first effect.
const idleChat = createStore<ChatState>()(() => initialChatState);

// Runs the agent service in the browser for as long as the provider is
// mounted, shows the key dialog whenever it asks for one, and applies the
// changes the agent asks for to the rack store.
export function GoodVibesAgentProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [service, setService] = useState<AgentService | undefined>(undefined);
  // Asked for from settings, so there is no prompt waiting on the answer.
  const [changingKey, setChangingKey] = useState(false);
  // The service outlives renders, and the sandbox client comes later, so the
  // agent's checks read the current one through this.
  const sandbox = useSandboxClient();
  const sandboxRef = useRef(sandbox);
  useEffect(() => {
    sandboxRef.current = sandbox;
  }, [sandbox]);

  useEffect(() => {
    const deps: ActionDeps = {
      store: rackStore,
      sandbox: () => sandboxRef.current,
      status: sandboxStatus.getState,
    };
    const scope = Effect.runSync(Scope.make());
    const made = Effect.runSync(
      makeAgentService({
        applyAction: (action, signal, turn) =>
          applyAction(deps, action, signal, turn),
        checkAfterTurn: (signal) => checkAfterTurn(deps, signal),
      }).pipe(Scope.provide(scope)),
    );
    setService(made);
    return () => {
      setService(undefined);
      Effect.runFork(Scope.close(scope, Exit.void));
    };
  }, []);

  const state = useStore(service?.chat ?? idleChat);
  const changeKey = useCallback(() => setChangingKey(true), []);

  const value = useMemo(
    () => ({
      messages: state.messages,
      busy: state.busy,
      queued: state.queued,
      prompt: (text: string) => service?.prompt(text),
      abort: () => service?.cancel(),
      changeKey,
    }),
    [state, service, changeKey],
  );

  return (
    <GoodVibesAgentContext.Provider value={value}>
      {children}
      {state.keyNeeded && (
        <ApiKeyDialog
          onSubmit={(key) => service?.submitKey(key)}
          onCancel={() => service?.declineKey()}
        />
      )}
      {changingKey && !state.keyNeeded && (
        <ApiKeyDialog
          onSubmit={(key) => {
            service?.setKey(key);
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
