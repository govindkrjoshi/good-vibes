import { Data } from "effect";
import type { StoreApi } from "zustand";
import type { Store } from "../stores";
import type { Credential } from "./providers";

// The app's store, as far as the agent reads and changes it. Its tools call
// the rack slice's actions, the same ones the canvas does.
export type RackStore = Pick<StoreApi<Store>, "getState" | "subscribe">;

// Reads the key for a request, and the service it is for. The browser has no
// environment to resolve a key from, so the agent is handed one of these and
// calls it on every request, letting the user change the key, or the
// service, mid-conversation.
export type ApiKey = () => Credential;

// What the agent says, in its own words. One reply can produce several of
// these: a message for each text part, a brief when it says what it is about
// to do (its `brief` tool), and a tool for each other tool it calls. Its
// reasoning is never passed on. All stream in: the same id is sent again as
// its text grows, or as the tool finishes, so a listener keeps the latest
// per id. A tool's text is what it did, or was doing until `done`; `result`
// is everything it reported back.
export type GoodVibesMessage =
  | { readonly type: "message"; readonly id: string; readonly text: string }
  | { readonly type: "brief"; readonly id: string; readonly text: string }
  | {
      readonly type: "tool";
      readonly id: string;
      readonly text: string;
      readonly done: boolean;
      readonly args: Readonly<Record<string, unknown>>;
      readonly result?: string;
      readonly error?: string;
    };

// What the chat shows of one message: who said it and the text so far. A
// brief is the agent saying what it is about to do; a tool is something it
// did to the rack, pending until it is done, with what it was asked and what
// it reported. A reply the user stopped is marked so. An error that a new
// key would fix says so, so the chat can offer the way there.
export type ChatMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly kind: "message" | "brief" | "tool";
  readonly text: string;
  readonly pending?: boolean;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly result?: string;
  readonly error?: string;
  readonly recover?: "key";
  readonly stopped?: boolean;
};

// Why a prompt got no reply, in words the chat can show.
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly message: string;
}> {}
