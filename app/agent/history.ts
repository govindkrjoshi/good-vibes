import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatMessage } from "./types";

// Where one conversation was kept before there could be several. Each chat
// now lives in the store's own storage with its rack (see stores/persist), so
// this is only read once, to bring an old conversation over.
export const legacyChatStorageKey = "good-vibes:chat";

export type StoredChat = {
  readonly messages: readonly ChatMessage[];
  readonly transcript: readonly AgentMessage[];
};

const roles = new Set(["user", "assistant"]);
const kinds = new Set(["message", "brief", "tool"]);

export const isChatMessage = (value: unknown): value is ChatMessage =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ChatMessage).id === "string" &&
  typeof (value as ChatMessage).text === "string" &&
  roles.has((value as ChatMessage).role) &&
  kinds.has((value as ChatMessage).kind);

export const isTranscriptMessage = (value: unknown): value is AgentMessage =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as AgentMessage).role === "string";

// A conversation as stored, or nothing when it is something else.
export const asStoredChat = (value: unknown): StoredChat | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { messages, transcript } = value as Partial<StoredChat>;
  if (!Array.isArray(messages) || !Array.isArray(transcript)) return undefined;
  if (!messages.every(isChatMessage)) return undefined;
  if (!transcript.every(isTranscriptMessage)) return undefined;
  return { messages, transcript };
};

// Storage can be missing, throw, or hold something older than this shape,
// all of which only mean there is nothing to bring over.
export const loadLegacyChat = (): StoredChat | undefined => {
  try {
    const raw = localStorage.getItem(legacyChatStorageKey);
    if (raw === null) return undefined;
    return asStoredChat(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

export const clearLegacyChat = () => {
  try {
    localStorage.removeItem(legacyChatStorageKey);
  } catch {
    // Nothing was kept, then.
  }
};

// A transcript the model can carry on from: it ends on a finished reply or
// on the results of the tools the reply called. A prompt that got no reply,
// or a reply that was stopped or failed, is left off so it is not resumed
// half-way; the chat still shows it.
export const settledTranscript = (
  messages: readonly AgentMessage[],
): AgentMessage[] => {
  const kept = messages.filter((message) => message.role !== "system");
  while (kept.length > 0) {
    const last = kept[kept.length - 1];
    if (last === undefined) break;
    if (last.role === "toolResult") break;
    if (
      last.role === "assistant" &&
      (last.stopReason === "stop" || last.stopReason === "length")
    )
      break;
    kept.pop();
  }
  return kept;
};
