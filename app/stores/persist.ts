import type {
  PersistOptions,
  PersistStorage,
  StorageValue,
} from "zustand/middleware";

import type { Store } from "./common";
import { initialChat } from "./chat";
import { initialRack } from "./rack";
import { asStoredChat, type StoredChat } from "../agent/history";
import type { RackState } from "../rack/model";

// Each chat is kept in this browser under its own key, with the rack it was
// building, so opening a chat brings back its graph too. Only the chat open
// now is read; the rest stay in storage until they are opened.
export const chatKeyPrefix = "good-vibes:chat:";
export const chatKey = (id: string) => `${chatKeyPrefix}${id}`;
// The key the store starts on, before any chat is open. Nothing is kept
// under it.
export const noChatKey = chatKeyPrefix;

export const chatIdOf = (key: string): string | undefined =>
  key.startsWith(chatKeyPrefix) && key !== noChatKey
    ? key.slice(chatKeyPrefix.length)
    : undefined;

// What is kept of the store for one chat. The catalogue is left out, as its
// plugins are code and are loaded afresh; so is anything that only makes
// sense while the page is open, like errors and whether it is playing.
export type SavedChat = {
  readonly rack: RackState;
  readonly chat: StoredChat;
};

export const savedChatVersion = 1;

export const partializeChat = ({ rack, chat }: Store): SavedChat => ({
  rack: {
    racks: rack.racks,
    jacks: rack.jacks,
    paramGroups: rack.paramGroups,
    methods: rack.methods,
    values: rack.values,
    automations: rack.automations,
    patches: rack.patches,
    events: rack.events,
    transport: { ...rack.transport, playing: false },
    rootId: rack.rootId,
  },
  chat: { messages: chat.messages, transcript: chat.transcript },
});

const records = [
  "racks",
  "jacks",
  "paramGroups",
  "methods",
  "values",
  "automations",
  "patches",
  "events",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Enough of a check that a rack from storage won't break the canvas: every
// part is there, and its root is. What is in each part is the store's to
// trust, as it wrote it.
const asRackState = (value: unknown): RackState | undefined => {
  if (!isRecord(value)) return undefined;
  if (!records.every((key) => isRecord(value[key]))) return undefined;
  if (typeof value.rootId !== "string") return undefined;
  if (!isRecord(value.transport)) return undefined;
  if (!isRecord((value.racks as Record<string, unknown>)[value.rootId]))
    return undefined;
  return value as RackState;
};

export const asSavedChat = (value: unknown): SavedChat | undefined => {
  if (!isRecord(value)) return undefined;
  const rack = asRackState(value.rack);
  const chat = asStoredChat(value.chat);
  return rack === undefined || chat === undefined ? undefined : { rack, chat };
};

// Puts a chat from storage in place of the one open, keeping the store's
// actions. A chat that is not there, or can't be read, opens empty. A tool
// that was still running when the chat was kept never finished.
export const mergeChat =
  (currentKey: () => string) =>
  (persisted: unknown, current: Store): Store => {
    const saved = asSavedChat(persisted);
    return {
      ...current,
      rack: {
        ...current.rack,
        ...(saved?.rack ?? initialRack),
        transport: {
          ...(saved?.rack ?? initialRack).transport,
          playing: false,
        },
        errors: [],
      },
      chat: {
        ...current.chat,
        ...initialChat,
        id: chatIdOf(currentKey()),
        messages: (saved?.chat.messages ?? []).map((message) =>
          message.pending === true ? { ...message, pending: false } : message,
        ),
        transcript: saved?.chat.transcript ?? [],
      },
    };
  };

export type ChatStorage = PersistStorage<SavedChat> & {
  // Writes what is waiting now, rather than after the delay.
  readonly flush: () => void;
};

// Local storage, written a moment after the last change rather than on
// every one, so dragging a slider or a streaming reply doesn't rewrite the
// whole chat each frame. What waits is written when the page is hidden, and
// is what a read gets back meanwhile. A write storage refuses is reported,
// and the chat carries on in memory.
export const chatStorage = ({
  delay = 300,
  onError,
}: {
  readonly delay?: number;
  readonly onError: (error: string | undefined) => void;
}): ChatStorage => {
  const waiting = new Map<string, StorageValue<SavedChat>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Told only when it changes: telling the store is itself a change, which
  // would otherwise be written again, and so on.
  let failing = false;
  const report = (failed: boolean) => {
    if (failed === failing) return;
    failing = failed;
    onError(
      failed
        ? "This chat could not be saved in this browser, so it will be lost on reload. Deleting old chats may make room."
        : undefined,
    );
  };

  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    for (const [key, value] of waiting) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        report(false);
      } catch {
        report(true);
      }
    }
    waiting.clear();
  };

  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

  return {
    getItem: (key) => {
      const pending = waiting.get(key);
      if (pending !== undefined) return pending;
      try {
        const raw = localStorage.getItem(key);
        return raw === null
          ? null
          : (JSON.parse(raw) as StorageValue<SavedChat>);
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      if (key === noChatKey) return;
      waiting.set(key, value);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    removeItem: (key) => {
      waiting.delete(key);
      try {
        localStorage.removeItem(key);
      } catch {
        // Nothing was kept, then.
      }
    },
    flush,
  };
};

export const chatPersistOptions = (
  storage: ChatStorage,
  currentKey: () => string,
): PersistOptions<Store, SavedChat> => ({
  name: noChatKey,
  storage,
  version: savedChatVersion,
  partialize: partializeChat,
  merge: mergeChat(currentKey),
  // A chat kept in a shape this version can't read opens empty.
  migrate: () => undefined as unknown as SavedChat,
  // The page is prerendered, so the chat is loaded once the browser has it;
  // see stores/chats.
  skipHydration: true,
});
