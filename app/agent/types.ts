import { Data } from "effect";

// Reads the OpenRouter key for a request. The browser has no environment to
// resolve a key from, so the agent is handed one of these and calls it on
// every request, letting the user change the key mid-conversation.
export type ApiKey = () => string;

// What the agent says, in its own words. One reply can produce several of
// these: a thought for each reasoning part and a message for each text part.
// Both stream in: the same id is sent again as its text grows, so a listener
// keeps the latest per id.
export type GoodVibesMessage =
  | { readonly type: "message"; readonly id: string; readonly text: string }
  | { readonly type: "thought"; readonly id: string; readonly text: string };

// Why a prompt got no reply, in words the chat can show.
export class PromptError extends Data.TaggedError("PromptError")<{
  readonly message: string;
}> {}
