import { createStore } from "zustand";
import { rackEnvelope, type RackEnvelope, type RackMsg } from "./messages";
import {
  rootRack,
  type AutomationEvent,
  type EventSettings,
  type ParamValue,
  type RackState,
  type RackTemplate,
  type Transport,
} from "./model";
import {
  initialRackMeta,
  reduceAll,
  type Outcome,
  type RackCore,
  type RackWork,
} from "./reduce";
import { resolvePatch } from "./rules";

export type { RackState };

// The store holds the rack and nothing about audio. The sandbox client
// follows it: it watches the rack change, and hears each trigger through
// onRackWork, and works out what to tell the frame from there.
export type RackStore = RackCore & {
  // The one way the rack changes: reduces the message (see reduce.ts) and
  // says what came of it. Nothing is published when nothing changed.
  readonly dispatch: (envelope: RackEnvelope) => Outcome;
  // Several messages, all or nothing; see reduceAll.
  readonly dispatchAll: (
    envelopes: readonly RackEnvelope[],
  ) => readonly Outcome[];

  // The actions below are thin wrappers over dispatch for the components that
  // still call them.
  readonly addBlock: (blockType: "leaf" | "tree") => string | undefined;
  // Adds a block built from a template, such as a catalogue entry, under the
  // given id or a fresh one. Refused when the id is taken.
  readonly addTemplate: (
    template: RackTemplate,
    id?: string,
  ) => string | undefined;
  readonly connectJacks: (
    fromJackId: string,
    toJackId: string,
  ) => string | undefined;
  readonly canConnectJacks: (fromJackId: string, toJackId: string) => boolean;
  readonly removeBlocks: (blockIds: readonly string[]) => void;
  readonly removePatches: (patchIds: readonly string[]) => void;
  // True when the value was kept; see acceptValue for what is refused.
  readonly setParamValue: (paramId: string, value: ParamValue) => boolean;
  readonly addAutomation: (
    paramId: string,
    event: Omit<AutomationEvent, "id">,
  ) => string | undefined;
  readonly removeAutomation: (paramId: string, eventId: string) => void;
  readonly playEvent: (eventId: string) => void;
  readonly addEvent: (
    methodId: string,
    settings: EventSettings,
  ) => string | undefined;
  readonly setEventSteps: (
    eventId: string,
    steps: readonly (string | number | null)[],
  ) => void;
  readonly updateEvent: (
    eventId: string,
    settings: Partial<EventSettings>,
  ) => void;
  readonly removeEvent: (eventId: string) => void;
  readonly setTransport: (transport: Transport) => boolean;
  readonly stop: () => void;
  readonly run: () => void;
};

// Listeners for triggers the store accepts: work for the sandbox that leaves
// the rack as it is, so watching the rack alone would miss it.
const workListeners = new Set<(work: readonly RackWork[]) => void>();

export const onRackWork = (
  listener: (work: readonly RackWork[]) => void,
): (() => void) => {
  workListeners.add(listener);
  return () => workListeners.delete(listener);
};

export const initialRackState: RackState = {
  blocks: { [rootRack.id]: rootRack },
  jacks: {},
  params: {},
  methods: {},
  values: {},
  automations: {},
  patches: {},
  events: {},
  transport: { bpm: 120 },
  rootId: rootRack.id,
};

const committed = (outcome: Outcome): string | undefined =>
  outcome._tag === "Committed" ? (outcome.id ?? "") : undefined;

// A vanilla store, so the rack can be driven without React. Components bind
// to it through useRack.
export const rackStore = createStore<RackStore>()((set, get) => {
  // Subscribers hear the new rack before the work listeners hear the
  // triggers that came with it, so a trigger always finds its rack.
  const dispatchAll = (envelopes: readonly RackEnvelope[]) => {
    const before = get();
    const { state, outcomes, work } = reduceAll(before, envelopes);
    if (state !== before) set(state, true);
    if (work.length > 0) for (const listener of workListeners) listener(work);
    return outcomes;
  };
  const dispatch = (envelope: RackEnvelope): Outcome =>
    dispatchAll([envelope])[0] ?? { _tag: "Unchanged" };
  const send = (msg: RackMsg) => dispatch(rackEnvelope(msg));

  return {
    ...initialRackState,
    ...initialRackMeta,
    dispatch,
    dispatchAll,

    addBlock: (blockType) =>
      committed(
        send({ _tag: "AddBlock", blockId: crypto.randomUUID(), blockType }),
      ),

    addTemplate: (template, blockId = crypto.randomUUID()) =>
      committed(send({ _tag: "AddTemplate", blockId, template })),

    canConnectJacks: (fromJackId, toJackId) =>
      resolvePatch(get(), fromJackId, toJackId) !== undefined,

    connectJacks: (from, to) => {
      const outcome = send({
        _tag: "ConnectJacks",
        patchId: crypto.randomUUID(),
        from,
        to,
      });
      // The patch already there comes back unchanged.
      return outcome._tag === "Unchanged" ? outcome.id : committed(outcome);
    },

    removeBlocks: (blockIds) => {
      send({ _tag: "RemoveBlocks", blockIds });
    },

    removePatches: (patchIds) => {
      send({ _tag: "RemovePatches", patchIds });
    },

    setParamValue: (paramId, value) =>
      send({ _tag: "SetParamValue", paramId, value })._tag !== "Refused",

    addAutomation: (paramId, event) =>
      committed(
        send({
          _tag: "AddAutomation",
          paramId,
          automationId: crypto.randomUUID(),
          event,
        }),
      ),

    removeAutomation: (paramId, automationId) => {
      send({ _tag: "RemoveAutomation", paramId, automationId });
    },

    // Fires an event's method once, now; see playArgs.
    playEvent: (eventId) => {
      send({ _tag: "PlayEvent", eventId });
    },

    addEvent: (methodId, settings) =>
      committed(
        send({
          _tag: "AddEvent",
          eventId: crypto.randomUUID(),
          methodId,
          settings,
        }),
      ),

    // Changes a sequence's steps; the sandbox hands a playing one its new
    // steps without rebuilding it.
    setEventSteps: (eventId, steps) => {
      send({ _tag: "SetEventSteps", eventId, steps });
    },

    updateEvent: (eventId, settings) => {
      send({ _tag: "UpdateEvent", eventId, settings });
    },

    removeEvent: (eventId) => {
      send({ _tag: "RemoveEvent", eventId });
    },

    setTransport: ({ bpm }) =>
      send({ _tag: "SetTransport", bpm })._tag !== "Refused",

    // The sandbox carries out Run and Stop in the order they came, after
    // every edit made before them.
    stop: () => {
      send({ _tag: "Stop" });
    },

    // Starts audio and builds the rack's Tone.js graph, rebuilding it from
    // scratch if it is already running. Audio starts in the sandbox frame,
    // which asks for a click of its own when the browser will not let it
    // start.
    run: () => {
      send({ _tag: "Run" });
    },
  };
});
