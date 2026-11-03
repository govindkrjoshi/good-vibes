import { Type } from "@earendil-works/pi-ai";
import {
  eventProblems,
  isRackEvent,
  stepsProblems,
  transportProblems,
  type EventSettings,
} from "../../rack";
import type { RackStore } from "../types";
import { eventFields, settingsFrom } from "./events";
import { eventOf, methodOf } from "./lookup";
import { defineTool, refuse, ToolProblem, type ErrorWatch } from "./tool";

const StepValue = Type.Union([Type.String(), Type.Number(), Type.Null()]);

const { kind: _kind, ...otherFields } = eventFields;

// Whether what came back fits the store's own schema, not just the checks.
const accept = (settings: EventSettings, methodId: string) => {
  const full = { ...settings, id: "x", belongToBlockId: "x", methodId };
  if (!isRackEvent(full)) {
    throw new ToolProblem("The event's settings don't fit its kind.");
  }
};

export const scheduleTools = (store: RackStore, watch: ErrorWatch) => [
  defineTool({
    name: "add_event",
    label: "Scheduling an event",
    description:
      "Schedules a method on a rack to be called as the transport plays: a sequence of steps, a loop, a pattern or a part. Give the method's id (rack:method:name) and the fields the kind reads.",
    parameters: Type.Object({ methodId: Type.String(), ...eventFields }),
    run: ({ methodId, ...fields }) => {
      const { rack } = store.getState();
      const method = methodOf(rack, methodId);
      const settings = settingsFrom(fields);
      accept(settings, methodId);
      refuse(eventProblems(method, settings));
      const id = watch.check(() => rack.addEvent(methodId, settings));
      return `Scheduled event [${id}]: ${settings.kind} on ${methodId}.${
        rack.transport.playing
          ? ""
          : " The transport is stopped, so it plays once started."
      }`;
    },
  }),
  defineTool({
    name: "update_event",
    label: "Changing an event",
    description:
      "Changes an event's settings; fields left out stay as they are. An event's kind can't change: remove it and add another instead.",
    parameters: Type.Object({ eventId: Type.String(), ...otherFields }),
    run: ({ eventId, ...fields }) => {
      const { rack } = store.getState();
      const held = eventOf(rack, eventId);
      const method = methodOf(rack, held.methodId);
      const settings = settingsFrom({ ...fields, kind: held.kind }, held);
      accept(settings, held.methodId);
      refuse(eventProblems(method, settings));
      watch.check(() => rack.updateEvent(eventId, settings));
      return `Changed event ${eventId}.`;
    },
  }),
  defineTool({
    name: "set_event_steps",
    label: "Setting steps",
    description:
      "Replaces a sequence's steps: notes or numbers, null for a rest.",
    parameters: Type.Object({
      eventId: Type.String(),
      steps: Type.Array(StepValue),
    }),
    run: ({ eventId, steps }) => {
      const { rack } = store.getState();
      const held = eventOf(rack, eventId);
      if (held.kind !== "sequence") {
        throw new ToolProblem(
          `${eventId} is a ${held.kind}, not a sequence; use update_event.`,
        );
      }
      refuse(stepsProblems(steps));
      watch.check(() => rack.setEventSteps(eventId, steps));
      return `Set ${steps.length} step(s) on ${eventId}.`;
    },
  }),
  defineTool({
    name: "remove_event",
    label: "Removing an event",
    description: "Removes a scheduled event.",
    parameters: Type.Object({ eventId: Type.String() }),
    run: ({ eventId }) => {
      const { rack } = store.getState();
      eventOf(rack, eventId);
      watch.check(() => rack.removeEvent(eventId));
      return `Removed event ${eventId}.`;
    },
  }),
  defineTool({
    name: "set_transport",
    label: "Setting the transport",
    description:
      "Sets the tempo and starts or stops the transport, which plays every event and automation. Sound needs a Destination rack patched in and the transport playing.",
    parameters: Type.Object({
      bpm: Type.Optional(Type.Number()),
      playing: Type.Optional(Type.Boolean()),
    }),
    run: ({ bpm, playing }) => {
      const { rack } = store.getState();
      const transport = {
        ...(bpm === undefined ? {} : { bpm }),
        ...(playing === undefined ? {} : { playing }),
      };
      refuse(transportProblems(transport));
      watch.check(() => rack.setTransport(transport));
      const now = store.getState().rack.transport;
      return `Transport: ${now.bpm} bpm, ${now.playing ? "playing" : "stopped"}.`;
    },
  }),
];
