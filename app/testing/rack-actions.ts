import type { StoreApi } from "zustand";
import {
  edits,
  idOf,
  rackEnvelope,
  type AutomationEvent,
  type EventSettings,
  type ParamValue,
  type RackMsg,
  type RackStore,
  type RackTemplate,
} from "../rack";

// Builds and edits a rack in tests as a person would: each call dispatches
// one message as the user's, and hands back the id of what it made, or
// whether it was kept. Only for tests; the app dispatches messages itself.
export const rackActions = (store: StoreApi<RackStore>) => {
  const send = (msg: RackMsg) => store.getState().dispatch(rackEnvelope(msg));
  const kept = (msg: RackMsg) => send(msg)._tag !== "Refused";
  return {
    addBlock: (blockType: "leaf" | "tree") =>
      idOf(send(edits.addBlock(blockType))),
    addTemplate: (template: RackTemplate, id?: string) =>
      idOf(send(edits.addTemplate(template, id))),
    connectJacks: (from: string, to: string) =>
      idOf(send(edits.connectJacks(from, to))),
    removeBlocks: (blockIds: readonly string[]) =>
      kept(edits.removeBlocks(blockIds)),
    removePatches: (patchIds: readonly string[]) =>
      kept(edits.removePatches(patchIds)),
    setParamValue: (paramId: string, value: ParamValue) =>
      kept(edits.setParamValue(paramId, value)),
    addAutomation: (paramId: string, event: Omit<AutomationEvent, "id">) =>
      idOf(send(edits.addAutomation(paramId, event))),
    removeAutomation: (paramId: string, automationId: string) =>
      kept(edits.removeAutomation(paramId, automationId)),
    addEvent: (methodId: string, settings: EventSettings) =>
      idOf(send(edits.addEvent(methodId, settings))),
    setEventSteps: (
      eventId: string,
      steps: readonly (string | number | null)[],
    ) => kept(edits.setEventSteps(eventId, steps)),
    updateEvent: (eventId: string, settings: Partial<EventSettings>) =>
      kept(edits.updateEvent(eventId, settings)),
    removeEvent: (eventId: string) => kept(edits.removeEvent(eventId)),
    setTransport: ({ bpm }: { readonly bpm: number }) =>
      kept(edits.setTransport(bpm)),
    playEvent: (eventId: string) => kept(edits.playEvent(eventId)),
    run: () => kept(edits.run()),
    stop: () => kept(edits.stop()),
  };
};
