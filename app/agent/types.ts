import type { Static } from "@earendil-works/pi-ai";
import { Data } from "effect";
import type { RackActionSchema } from "./rack-action";

// Reads the OpenRouter key for a request. The browser has no environment to
// resolve a key from, so the agent is handed one of these and calls it on
// every request, letting the user change the key mid-conversation.
export type ApiKey = () => string;

// A change the agent asks for. The agent never touches the rack itself: each
// of these goes out as an action message, whoever listens applies it, and the
// result comes back through `settle`. The shape is the model's tool schema,
// see ./rack-action; this import is types only, so the model runtime stays
// out of the initial bundle.
export type RackAction = Static<typeof RackActionSchema>;

// What came of an action. `text` is a sentence for both the chat and the
// model; `data` is extra detail for the model alone, such as the ids of what
// was made.
export type ActionResult = {
  readonly ok: boolean;
  readonly text: string;
  readonly data?: unknown;
};

export type ActionStatus = "requested" | "done" | "failed";

// What the agent says, in its own words, and what it asks to be done. One
// reply can produce several of these: a thought for each reasoning part, a
// message for each text part, and an action for each tool call. All stream
// in: the same id is sent again as a text grows or an action settles, so a
// listener keeps the latest per id.
export type GoodVibesMessage =
  | { readonly type: "message"; readonly id: string; readonly text: string }
  | { readonly type: "thought"; readonly id: string; readonly text: string }
  | {
      readonly type: "action";
      readonly id: string;
      readonly action: RackAction;
      readonly status: ActionStatus;
      // Once settled: what came of it.
      readonly result?: ActionResult;
    };

// Why a prompt got no reply, in words the chat can show.
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly message: string;
}> {}
