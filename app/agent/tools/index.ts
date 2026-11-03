import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { RackStore } from "../types";
import { briefTool } from "./brief";
import { jackTools } from "./jacks";
import { paramTools } from "./params";
import { rackTools } from "./racks";
import { readTools } from "./read";
import { scheduleTools } from "./schedule";
import { createErrorWatch, type ErrorWatch } from "./tool";

export { createErrorWatch, type ErrorWatch } from "./tool";
export { patchRule } from "./jacks";
export { codeHelp } from "./spec";
export { describeRackTree } from "./describe";

// Every tool the agent has: one for each thing a user can do to the rack,
// plus reading the rack and the catalogue, and `brief` for saying what it is
// about to do.
export const createRackTools = (
  store: RackStore,
  watch: ErrorWatch = createErrorWatch(store),
): AgentTool<any>[] => [
  briefTool(),
  ...readTools(store),
  ...rackTools(store, watch),
  ...jackTools(store, watch),
  ...paramTools(store, watch),
  ...scheduleTools(store, watch),
];
