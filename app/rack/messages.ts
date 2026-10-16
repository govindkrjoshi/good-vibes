import type {
  AutomationEvent,
  EventSettings,
  ParamValue,
  RackTemplate,
} from "./model";

// Every change to the rack, as data. The store only changes by reducing one
// of these (see reduce.ts), whether it came from the user or the agent.
//
// A message names every id it creates, so reducing it is pure: the caller
// picks the id, as the agent already does for the blocks it adds.

export type RackEdit =
  | {
      readonly _tag: "AddBlock";
      readonly blockId: string;
      readonly blockType: "leaf" | "tree";
    }
  | {
      readonly _tag: "AddTemplate";
      readonly blockId: string;
      readonly template: RackTemplate;
    }
  | {
      readonly _tag: "ConnectJacks";
      readonly patchId: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly _tag: "RemoveBlocks"; readonly blockIds: readonly string[] }
  | { readonly _tag: "RemovePatches"; readonly patchIds: readonly string[] }
  | {
      readonly _tag: "SetParamValue";
      readonly paramId: string;
      readonly value: ParamValue;
    }
  | {
      readonly _tag: "AddAutomation";
      readonly paramId: string;
      readonly automationId: string;
      readonly event: Omit<AutomationEvent, "id">;
    }
  | {
      readonly _tag: "RemoveAutomation";
      readonly paramId: string;
      readonly automationId: string;
    }
  | {
      readonly _tag: "AddEvent";
      readonly eventId: string;
      readonly methodId: string;
      readonly settings: EventSettings;
    }
  | {
      readonly _tag: "SetEventSteps";
      readonly eventId: string;
      readonly steps: readonly (string | number | null)[];
    }
  | {
      readonly _tag: "UpdateEvent";
      readonly eventId: string;
      readonly settings: Partial<EventSettings>;
    }
  | { readonly _tag: "RemoveEvent"; readonly eventId: string }
  | { readonly _tag: "SetTransport"; readonly bpm: number };

// Work for the sandbox that leaves the rack as it is. Each still takes a
// place in the order of work (see `workSeq` in reduce.ts), so whatever waits
// on the sandbox can wait on these too.
export type RackTrigger =
  | { readonly _tag: "Run" }
  | { readonly _tag: "Stop" }
  | { readonly _tag: "PlayEvent"; readonly eventId: string }
  // Builds an entity again even though it has not changed, as after a
  // failure that might not happen twice.
  | {
      readonly _tag: "Retry";
      readonly entity: "block" | "patch" | "event";
      readonly entityId: string;
    };

export type RackMsg = RackEdit | RackTrigger;

export type Origin = "user" | "agent";

export type RackEnvelope = {
  readonly id: string;
  readonly origin: Origin;
  // The agent's run that sent this, and the user prompt that run answers.
  readonly turnId?: string;
  readonly chainId?: string;
  readonly msg: RackMsg;
};

// Wraps a message for dispatch under a fresh id.
export const rackEnvelope = (
  msg: RackMsg,
  origin: Origin = "user",
  turn: { readonly turnId?: string; readonly chainId?: string } = {},
): RackEnvelope => ({ id: crypto.randomUUID(), origin, ...turn, msg });
