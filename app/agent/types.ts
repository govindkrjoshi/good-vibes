import { Data } from "effect";
import type { StoreApi } from "zustand";
import type { Store } from "../stores";

// The app's store, as far as the agent reads and changes it. Its tools call
// the rack slice's actions, the same ones the canvas does.
export type RackStore = Pick<StoreApi<Store>, "getState" | "subscribe">;

// Reads the OpenRouter key for a request. The browser has no environment to
// resolve a key from, so the agent is handed one of these and calls it on
// every request, letting the user change the key mid-conversation.
export type ApiKey = () => string;

// What the agent says, in its own words. One reply can produce several of
// these: a thought for each reasoning part, a message for each text part, and
// a tool for each tool it calls. All stream in: the same id is sent again as
// its text grows, or as the tool finishes, so a listener keeps the latest per
// id. A tool's text is what it did, or was doing until `done`.
export type GoodVibesMessage =
  | { readonly type: "message"; readonly id: string; readonly text: string }
  | { readonly type: "thought"; readonly id: string; readonly text: string }
  | {
      readonly type: "tool";
      readonly id: string;
      readonly text: string;
      readonly done: boolean;
      readonly error?: string;
    };

// Why a prompt got no reply, in words the chat can show.
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly message: string;
}> {}
