import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createStore, useStore } from "zustand";
import {
  initialChatState,
  type ChatMessage,
  type ChatState,
} from "../../agent";
import { useAgentService } from "../app/app-provider";
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

// The chat, from the app's agent service: what it says, and the key dialog
// whenever it asks for one.
export function GoodVibesAgentProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const service = useAgentService();
  // Asked for from settings, so there is no prompt waiting on the answer.
  const [changingKey, setChangingKey] = useState(false);

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
