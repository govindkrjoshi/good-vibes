import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createSession,
  noKeyGiven,
  type ChatMessage,
  type Credential,
  type SessionState,
} from "../../agent";
import { useStore } from "../../stores";
import {
  deleteChat,
  newChat,
  openChat,
  recentChats,
  startChats,
  useChats,
  type ChatSummary,
} from "../../stores/chats";
import { ApiKeyDialog } from "./api-key-dialog";

export type { ChatMessage } from "../../agent";

type GoodVibesAgentContextValue = {
  readonly messages: readonly ChatMessage[];
  // True from a prompt being sent until the agent has finished replying.
  readonly busy: boolean;
  readonly prompt: (text: string) => Promise<void>;
  readonly abort: () => void;
  // The chats kept in this browser, newest first, and the one open.
  readonly chats: readonly ChatSummary[];
  readonly selectedId: string | undefined;
  // Each loads the chat's rack along with its conversation.
  readonly newChat: () => void;
  readonly openChat: (id: string) => void;
  readonly deleteChat: (id: string) => void;
  // Why the open chat could not be kept in this browser, if it could not.
  readonly saveError: string | undefined;
  readonly changeKey: () => void;
};

const GoodVibesAgentContext = createContext<
  GoodVibesAgentContextValue | undefined
>(undefined);

// What the server renders, and so what the client must render while it
// hydrates: the conversation kept in this browser's storage is only loaded
// once React has taken over, or the two would not match.
const beforeHydration: SessionState = { messages: [], busy: false };

type KeyRequest = {
  readonly promise: Promise<Credential>;
  readonly resolve: (credential: Credential) => void;
  readonly reject: (error: Error) => void;
};

const keyRequest = (): KeyRequest => {
  let resolve!: (credential: Credential) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Credential>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

// Runs one agent session in the browser for as long as the provider is
// mounted, and shows the key dialog whenever the session asks for one.
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
      store: useStore,
      chatLoaded: startChats,
      askForKey: () => {
        const asked = keyRequest();
        setRequest(asked);
        return asked.promise;
      },
    }),
  );
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    () => beforeHydration,
  );

  const answer = (settle: (request: KeyRequest) => void) => {
    setRequest(undefined);
    if (request !== undefined) settle(request);
  };

  const chats = useChats((chats) => chats.chats);
  const selectedId = useChats((chats) => chats.selectedId);
  const saveError = useStore((store) => store.chat.saveError);
  const recent = useMemo(() => recentChats(chats), [chats]);

  // The chat open last, with its rack, once the page is in the browser.
  useEffect(() => {
    void startChats();
  }, []);

  const changeKey = useCallback(() => setChangingKey(true), []);

  const value = useMemo(
    () => ({
      messages: state.messages,
      busy: state.busy,
      prompt: session.prompt,
      abort: session.abort,
      chats: recent,
      selectedId,
      newChat: () => void newChat(),
      openChat: (id: string) => void openChat(id),
      deleteChat: (id: string) => void deleteChat(id),
      saveError,
      changeKey,
    }),
    [state, session, recent, selectedId, saveError, changeKey],
  );

  return (
    <GoodVibesAgentContext.Provider value={value}>
      {children}
      {request !== undefined && (
        <ApiKeyDialog
          onSubmit={(credential) =>
            answer((asked) => asked.resolve(credential))
          }
          onCancel={() =>
            answer((asked) => asked.reject(new Error(noKeyGiven)))
          }
        />
      )}
      {changingKey && request === undefined && (
        <ApiKeyDialog
          initialProvider={session.currentKey()?.provider}
          onSubmit={(credential) => {
            session.setKey(credential);
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
