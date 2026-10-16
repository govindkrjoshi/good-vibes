import type { RackMsg, RackTrigger } from "./messages";
import type {
  AutomationEvent,
  EventSettings,
  ParamValue,
  RackState,
  RackTemplate,
} from "./model";
import type { Outcome } from "./reduce";
import { resolvePatch } from "./rules";

// The messages the app sends for what a person does, each with fresh ids
// for anything it makes, so callers never pick ids themselves. Dispatch
// them; the outcome says what came of it and carries the new id.

const newId = () => crypto.randomUUID();

export const edits = {
  addBlock: (
    blockType: "leaf" | "tree",
    blockId: string = newId(),
  ): RackMsg => ({
    _tag: "AddBlock",
    blockId,
    blockType,
  }),
  addTemplate: (
    template: RackTemplate,
    blockId: string = newId(),
  ): RackMsg => ({
    _tag: "AddTemplate",
    blockId,
    template,
  }),
  connectJacks: (
    from: string,
    to: string,
    patchId: string = newId(),
  ): RackMsg => ({
    _tag: "ConnectJacks",
    patchId,
    from,
    to,
  }),
  removeBlocks: (blockIds: readonly string[]): RackMsg => ({
    _tag: "RemoveBlocks",
    blockIds,
  }),
  removePatches: (patchIds: readonly string[]): RackMsg => ({
    _tag: "RemovePatches",
    patchIds,
  }),
  setParamValue: (paramId: string, value: ParamValue): RackMsg => ({
    _tag: "SetParamValue",
    paramId,
    value,
  }),
  addAutomation: (
    paramId: string,
    event: Omit<AutomationEvent, "id">,
    automationId: string = newId(),
  ): RackMsg => ({ _tag: "AddAutomation", paramId, automationId, event }),
  removeAutomation: (paramId: string, automationId: string): RackMsg => ({
    _tag: "RemoveAutomation",
    paramId,
    automationId,
  }),
  addEvent: (
    methodId: string,
    settings: EventSettings,
    eventId: string = newId(),
  ): RackMsg => ({ _tag: "AddEvent", eventId, methodId, settings }),
  setEventSteps: (
    eventId: string,
    steps: readonly (string | number | null)[],
  ): RackMsg => ({ _tag: "SetEventSteps", eventId, steps }),
  updateEvent: (
    eventId: string,
    settings: Partial<EventSettings>,
  ): RackMsg => ({
    _tag: "UpdateEvent",
    eventId,
    settings,
  }),
  removeEvent: (eventId: string): RackMsg => ({ _tag: "RemoveEvent", eventId }),
  setTransport: (bpm: number): RackMsg => ({ _tag: "SetTransport", bpm }),
  run: (): RackTrigger => ({ _tag: "Run" }),
  stop: (): RackTrigger => ({ _tag: "Stop" }),
  playEvent: (eventId: string): RackTrigger => ({ _tag: "PlayEvent", eventId }),
  retry: (
    entity: "block" | "patch" | "event",
    entityId: string,
  ): RackTrigger => ({
    _tag: "Retry",
    entity,
    entityId,
  }),
};

// The id an outcome carries: what was made, or the patch already there.
export const idOf = (outcome: Outcome): string | undefined =>
  (outcome._tag === "Committed" || outcome._tag === "Unchanged") &&
  outcome.id !== undefined
    ? outcome.id
    : undefined;

// Whether two jacks can be patched, without trying it.
export const canConnectJacks = (
  state: RackState,
  fromJackId: string,
  toJackId: string,
): boolean => resolvePatch(state, fromJackId, toJackId) !== undefined;
