import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { storage, useStore } from ".";
import { initialRack } from "./rack";
import {
  chatKey,
  partializeChat,
  savedChatVersion,
  type SavedChat,
} from "./persist";
import { clearLegacyChat, loadLegacyChat } from "../agent/history";

// The chats kept in this browser, as a list to pick from. Each one's rack
// and conversation is kept apart under its own key and read only when it is
// opened; see stores/persist.
export const chatsStorageKey = "good-vibes:chats";

export type ChatSummary = {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly updatedAt: number;
};

type ChatsState = {
  readonly chats: readonly ChatSummary[];
  // The chat open now.
  readonly selectedId: string | undefined;
};

export const untitled = "New conversation";

const isSummary = (value: unknown): value is ChatSummary =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ChatSummary).id === "string" &&
  typeof (value as ChatSummary).title === "string" &&
  typeof (value as ChatSummary).createdAt === "number" &&
  typeof (value as ChatSummary).updatedAt === "number";

export const useChats = create<ChatsState>()(
  persist(() => ({ chats: [], selectedId: undefined }) as ChatsState, {
    name: chatsStorageKey,
    storage: createJSONStorage(() => localStorage),
    version: 1,
    // A list that can't be read is started afresh; the chats it named stay
    // in storage, out of reach.
    merge: (persisted, current) => {
      const saved = persisted as Partial<ChatsState> | undefined;
      const chats = Array.isArray(saved?.chats)
        ? saved.chats.filter(isSummary)
        : [];
      const selectedId =
        typeof saved?.selectedId === "string" ? saved.selectedId : undefined;
      return { ...current, chats, selectedId };
    },
    skipHydration: true,
  }),
);

// Newest first, as the chat list shows them.
export const recentChats = (chats: readonly ChatSummary[]) =>
  [...chats].sort((a, b) => b.updatedAt - a.updatedAt);

const titleOf = (text: string) => {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line;
};

const summary = (id: string, title = untitled): ChatSummary => {
  const now = Date.now();
  return { id, title, createdAt: now, updatedAt: now };
};

const isEmpty = () => {
  const { rack, chat } = useStore.getState();
  const root = rack.racks[rack.rootId];
  return (
    chat.messages.length === 0 &&
    (root?.type !== "tree" || root.children.length === 0)
  );
};

// Puts a chat's rack and conversation in the store in place of the one
// open, writing what the open one had first. A chat left with nothing in it
// is dropped rather than kept in the list.
export const openChat = async (id: string) => {
  const leaving = useChats.getState().selectedId;
  if (leaving === id && useStore.getState().chat.id === id) return;
  storage.flush();
  if (leaving !== undefined && leaving !== id && isEmpty()) forget(leaving);
  useStore.persist.setOptions({ name: chatKey(id) });
  await useStore.persist.rehydrate();
  useChats.setState({ selectedId: id });
};

// Opens a chat with nothing in it yet: an empty rack and no conversation.
export const newChat = async () => {
  const id = crypto.randomUUID();
  useChats.setState(({ chats }) => ({ chats: [...chats, summary(id)] }));
  await openChat(id);
};

const forget = (id: string) => {
  storage.removeItem(chatKey(id));
  useChats.setState(({ chats, selectedId }) => ({
    chats: chats.filter((chat) => chat.id !== id),
    selectedId: selectedId === id ? undefined : selectedId,
  }));
};

// Deletes a chat and its rack. Deleting the open one opens the most recent
// other, or a new one when there is none.
export const deleteChat = async (id: string) => {
  const wasOpen = useChats.getState().selectedId === id;
  forget(id);
  if (!wasOpen) return;
  const next = recentChats(useChats.getState().chats)[0];
  if (next === undefined) await newChat();
  else await openChat(next.id);
};

// The one conversation kept before there could be several, brought over as
// a chat with an empty rack, as its rack was never kept.
const importLegacy = () => {
  const legacy = loadLegacyChat();
  if (legacy === undefined) return;
  const id = crypto.randomUUID();
  const first = legacy.messages.find((message) => message.role === "user");
  const saved: SavedChat = {
    rack: partializeChat({
      ...useStore.getState(),
      rack: { ...useStore.getState().rack, ...initialRack },
    }).rack,
    chat: legacy,
  };
  try {
    localStorage.setItem(
      chatKey(id),
      JSON.stringify({ state: saved, version: savedChatVersion }),
    );
  } catch {
    return;
  }
  useChats.setState(({ chats }) => ({
    chats: [...chats, summary(id, first ? titleOf(first.text) : untitled)],
    selectedId: id,
  }));
  clearLegacyChat();
};

// Keeps the open chat's entry in the list up to date: titled by its first
// message, and moved up when something is said.
const watchOpenChat = () =>
  useStore.subscribe((next, prev) => {
    const { id, messages } = next.chat;
    if (id === undefined || id !== prev.chat.id) return;
    if (messages.length === prev.chat.messages.length) return;
    const first = messages.find((message) => message.role === "user");
    useChats.setState(({ chats }) => ({
      chats: chats.map((chat) =>
        chat.id === id
          ? {
              ...chat,
              title: first ? titleOf(first.text) : chat.title,
              updatedAt: Date.now(),
            }
          : chat,
      ),
    }));
  });

let started: Promise<void> | undefined;
let unwatch: (() => void) | undefined;

// Reads the list of chats and opens the one that was open last, or the
// most recent, or a new one. Safe to call more than once.
export const startChats = () =>
  (started ??= (async () => {
    await useChats.persist.rehydrate();
    if (useChats.getState().chats.length === 0) importLegacy();
    unwatch = watchOpenChat();
    const { chats, selectedId } = useChats.getState();
    const open =
      chats.find((chat) => chat.id === selectedId) ?? recentChats(chats)[0];
    if (open === undefined) await newChat();
    else await openChat(open.id);
  })());

// For tests: forgets that the chats were started, so the next start reads
// storage again.
export const stopChats = () => {
  unwatch?.();
  unwatch = undefined;
  started = undefined;
  storage.flush();
};
