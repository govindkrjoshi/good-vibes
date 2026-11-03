import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RackStore } from "../types";
import { jackTools } from "./jacks";
import { paramTools } from "./params";
import { rackTools } from "./racks";
import { readTools } from "./read";
import { scheduleTools } from "./schedule";
import { createErrorWatch, type ErrorWatch } from "./tool";

export { createErrorWatch, type ErrorWatch } from "./tool";
export { patchRule } from "./jacks";
export { codeHelp } from "./spec";

// Every tool the agent has: one for each thing a user can do to the rack,
// plus reading the rack and the catalogue.
export const createRackTools = (
  store: RackStore,
  watch: ErrorWatch = createErrorWatch(store),
): AgentTool<any>[] => [
  ...readTools(store),
  ...rackTools(store, watch),
  ...jackTools(store, watch),
  ...paramTools(store, watch),
  ...scheduleTools(store, watch),
];
