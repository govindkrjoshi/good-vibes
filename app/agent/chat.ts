import type { ActionStatus, GoodVibesMessage, RackAction } from "./types";

// What the chat shows, as a pure fold over what happens in the conversation.
// The agent service (./service) is the only thing that feeds it.

// One row of the chat: who said it and the text so far. The agent's thoughts
// are its reasoning, shown apart from what it says. An action is a change the
// agent asked for: its text says what it is doing until it is done, then what
// came of it. A notice is the app speaking, as when it finds errors after a
// turn and asks the agent to fix them.
export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system";
  readonly kind: "message" | "thought" | "action" | "notice";
  readonly text: string;
  readonly error?: string;
  readonly status?: ActionStatus;
};

export type ChatState = {
  readonly messages: readonly ChatMessage[];
  // True while a prompt runs or waits to.
  readonly busy: boolean;
  // Prompts sent while the agent was busy, waiting their turn.
  readonly queued: number;
  // True while a prompt waits on the user for an OpenRouter key.
  readonly keyNeeded: boolean;
};

export const initialChatState: ChatState = {
  messages: [],
  busy: false,
  queued: 0,
  keyNeeded: false,
};

export type ChatEvent =
  | {
      readonly _tag: "Prompted";
      readonly turnId: string;
      readonly text: string;
    }
  | { readonly _tag: "AgentSaid"; readonly said: GoodVibesMessage }
  // The turn's reply failed; shown on the reply, or on its own.
  | {
      readonly _tag: "ReplyFailed";
      readonly turnId: string;
      readonly error: string;
    }
  | { readonly _tag: "Noticed"; readonly id: string; readonly text: string }
  | {
      readonly _tag: "Working";
      readonly busy: boolean;
      readonly queued: number;
    }
  | { readonly _tag: "KeyNeeded"; readonly needed: boolean };

// What the chat shows of an action until it has been applied.
export const actionLabel = (action: RackAction): string => {
  switch (action.kind) {
    case "describe":
      return "Looking at the rack";
    case "add_block":
      return `Adding ${action.entry} as ${action.id}`;
    case "remove_blocks":
      return action.blockIds.length === 1
        ? "Removing a block"
        : `Removing ${action.blockIds.length} blocks`;
    case "connect_blocks":
      return "Connecting blocks";
    case "disconnect":
      return "Disconnecting";
    case "set_param":
      return "Setting a param";
    case "set_transport":
      return `Setting the tempo to ${action.bpm} bpm`;
    case "check_errors":
      return "Checking for errors";
    case "retry":
      return `Trying the ${action.entity} ${action.id} again`;
  }
};

const actionRow = (
  said: GoodVibesMessage & { type: "action" },
): ChatMessage => {
  const shared = {
    id: `agent-${said.id}`,
    role: "assistant",
    kind: "action",
  } as const;
  const label = actionLabel(said.action);
  switch (said.status) {
    case "requested":
      return { ...shared, text: label, status: "requested" };
    case "done":
      return { ...shared, text: said.result?.text ?? label, status: "done" };
    case "failed":
      return {
        ...shared,
        text: label,
        status: "failed",
        error: said.result?.text ?? "The change could not be made",
      };
  }
};

// The agent sends a message again as it grows or settles, so an id already
// shown is replaced in place.
const upsert = (
  messages: readonly ChatMessage[],
  message: ChatMessage,
): readonly ChatMessage[] =>
  messages.some((held) => held.id === message.id)
    ? messages.map((held) => (held.id === message.id ? message : held))
    : [...messages, message];

export const reduceChat = (state: ChatState, event: ChatEvent): ChatState => {
  switch (event._tag) {
    case "Prompted":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `user-${event.turnId}`,
            role: "user",
            kind: "message",
            text: event.text,
          },
        ],
      };

    case "AgentSaid": {
      const { said } = event;
      return {
        ...state,
        messages: upsert(
          state.messages,
          said.type === "action"
            ? actionRow(said)
            : {
                id: `agent-${said.id}`,
                role: "assistant",
                kind: said.type,
                text: said.text,
              },
        ),
      };
    }

    // Shown on the reply that failed, or on its own when nothing arrived.
    case "ReplyFailed": {
      const last = state.messages.at(-1);
      return {
        ...state,
        messages:
          last?.role === "assistant"
            ? [...state.messages.slice(0, -1), { ...last, error: event.error }]
            : [
                ...state.messages,
                {
                  id: `error-${event.turnId}`,
                  role: "assistant",
                  kind: "message",
                  text: "",
                  error: event.error,
                },
              ],
      };
    }

    case "Noticed":
      return {
        ...state,
        messages: upsert(state.messages, {
          id: event.id,
          role: "system",
          kind: "notice",
          text: event.text,
        }),
      };

    case "Working":
      return state.busy === event.busy && state.queued === event.queued
        ? state
        : { ...state, busy: event.busy, queued: event.queued };

    case "KeyNeeded":
      return state.keyNeeded === event.needed
        ? state
        : { ...state, keyNeeded: event.needed };
  }
};
