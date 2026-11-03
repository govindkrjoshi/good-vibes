import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ChatMessage } from "./types";

// The conversation, kept in this browser so a reload picks it up where it
// left off: what the chat showed, and the agent's own transcript so the
// model remembers the same conversation the user sees. The rack itself is
// not kept, so the agent is told the page reloaded when it resumes.
export const chatStorageKey = "good-vibes:chat";

export type StoredChat = {
  readonly messages: readonly ChatMessage[];
  readonly transcript: readonly AgentMessage[];
};

const roles = new Set(["user", "assistant"]);
const kinds = new Set(["message", "brief", "tool"]);

const isChatMessage = (value: unknown): value is ChatMessage =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as ChatMessage).id === "string" &&
  typeof (value as ChatMessage).text === "string" &&
  roles.has((value as ChatMessage).role) &&
  kinds.has((value as ChatMessage).kind);

const isTranscriptMessage = (value: unknown): value is AgentMessage =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as AgentMessage).role === "string";

// Storage can be missing, throw, or hold something older than this shape,
// all of which only mean starting afresh.
export const loadChat = (): StoredChat | undefined => {
  try {
    const raw = localStorage.getItem(chatStorageKey);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const { messages, transcript } = parsed as Partial<StoredChat>;
    if (!Array.isArray(messages) || !Array.isArray(transcript))
      return undefined;
    if (!messages.every(isChatMessage)) return undefined;
    if (!transcript.every(isTranscriptMessage)) return undefined;
    return { messages, transcript };
  } catch {
    return undefined;
  }
};

export const storeChat = (chat: StoredChat) => {
  try {
    localStorage.setItem(chatStorageKey, JSON.stringify(chat));
  } catch {
    // Kept for this page load only.
  }
};

export const clearChat = () => {
  try {
    localStorage.removeItem(chatStorageKey);
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
