import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { castDraft } from "immer";

import type { SliceCreator } from "./common";
import type { ChatMessage } from "../agent/types";

type State = {
  // The chat open now, set as it is loaded; none until one is.
  readonly id: string | undefined;
  // What the chat shows.
  readonly messages: readonly ChatMessage[];
  // The model's side of the same conversation, as far as it has settled, so
  // the agent can carry it on. See settledTranscript.
  readonly transcript: readonly AgentMessage[];
  // Why the chat could not be kept in this browser, if it could not.
  readonly saveError: string | undefined;
};

type Actions = {
  readonly setMessages: (
    update: (messages: readonly ChatMessage[]) => readonly ChatMessage[],
  ) => void;
  readonly setTranscript: (transcript: readonly AgentMessage[]) => void;
  readonly setSaveError: (error: string | undefined) => void;
};

export type ChatSlice = State & Actions;

export const initialChat: State = {
  id: undefined,
  messages: [],
  transcript: [],
  saveError: undefined,
};

export const createChatSlice: SliceCreator<ChatSlice> = (set, get) => ({
  ...initialChat,
  setMessages: (update) =>
    set(
      (state) => {
        state.chat.messages = castDraft(update(get().chat.messages));
      },
      false,
      "chat/setMessages",
    ),
  setTranscript: (transcript) =>
    set(
      (state) => {
        state.chat.transcript = castDraft(transcript);
      },
      false,
      "chat/setTranscript",
    ),
  setSaveError: (error) =>
    set(
      (state) => {
        state.chat.saveError = error;
      },
      false,
      "chat/setSaveError",
    ),
});
