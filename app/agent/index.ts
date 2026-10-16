// The agent itself (./agent) is left out on purpose: it pulls in the model
// runtime, which the service loads on first use to keep it out of the initial
// bundle. Import it from "./agent/agent" where it is really needed.
export {
  actionLabel,
  initialChatState,
  reduceChat,
  type ChatEvent,
  type ChatMessage,
  type ChatState,
} from "./chat";
export {
  makeAgentService,
  type AgentDebugEvent,
  type AgentService,
  type AgentServiceOptions,
  type CreateAgent,
  type FixupCheck,
  type Turn,
} from "./service";
export { apiKeyStorageKey, knownApiKey, storeApiKey } from "./key";
export type { ApplyAction } from "./tools";
export {
  PromptError,
  type ActionResult,
  type ActionStatus,
  type ApiKey,
  type GoodVibesMessage,
  type RackAction,
} from "./types";
