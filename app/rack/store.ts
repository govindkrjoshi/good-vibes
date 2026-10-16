import { Effect } from "effect";
import { createStore } from "zustand";
import { entityChanges } from "./entities";
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
  playArgs,
  reduceAll,
  type Outcome,
  type RackCore,
} from "./reduce";
import { noopRuntime, type RackRuntime } from "./renderer";
import { resolvePatch } from "./rules";

export type { RackState };

export type RackStore = RackCore & {
  // The live Tone.js graph, which lives in the sandbox frame; the sandbox
  // provider plugs in its end once the frame is up. Each action below that
  // changes the rack tells it what changed, once the store itself has been
  // updated.
  readonly runtime: RackRuntime;
  // The one way the rack changes: reduces the message (see reduce.ts) and
  // says what came of it. Nothing is published when nothing changed.
  readonly dispatch: (envelope: RackEnvelope) => Outcome;
  // Several messages, all or nothing; see reduceAll.
  readonly dispatchAll: (
    envelopes: readonly RackEnvelope[],
  ) => readonly Outcome[];

  // The actions below are thin wrappers over dispatch for the components that
  // still call them, and they still drive the runtime themselves.
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

// Each Run waits for the one before it, so two quick ones cannot render over
// each other.
let running: Promise<void> = Promise.resolve();

// A failure in the audio graph is the renderer's to report, not a reason to
// undo the edit, so the store only logs it.
const perform = (effect: Effect.Effect<void, unknown>) => {
  Effect.runPromise(effect).catch((error) => console.warn(error));
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
  const dispatchAll = (envelopes: readonly RackEnvelope[]) => {
    const before = get();
    const { state, outcomes } = reduceAll(before, envelopes);
    if (state !== before) set(state, true);
    return outcomes;
  };
  const dispatch = (envelope: RackEnvelope): Outcome =>
    dispatchAll([envelope])[0] ?? { _tag: "Unchanged" };
  const send = (msg: RackMsg) => dispatch(rackEnvelope(msg));

  return {
    ...initialRackState,
    ...initialRackMeta,
    runtime: noopRuntime,
    dispatch,
    dispatchAll,

    addBlock: (blockType) => {
      const id = committed(
        send({ _tag: "AddBlock", blockId: crypto.randomUUID(), blockType }),
      );
      if (id === undefined) return undefined;
      perform(get().runtime.addBlock(id));
      return id;
    },

    addTemplate: (template, blockId = crypto.randomUUID()) => {
      const id = committed(send({ _tag: "AddTemplate", blockId, template }));
      if (id === undefined) return undefined;
      perform(get().runtime.addBlock(id));
      return id;
    },

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
      if (outcome._tag === "Unchanged") return outcome.id;
      const id = committed(outcome);
      if (id === undefined) return undefined;
      perform(get().runtime.addPatch(id));
      return id;
    },

    removeBlocks: (blockIds) => {
      const before = get();
      if (send({ _tag: "RemoveBlocks", blockIds })._tag !== "Committed") return;

      const removed = entityChanges(before, get());
      const root = before.blocks[before.rootId];
      const cut = (root?.type === "tree" ? root.patches : []).filter((id) =>
        removed.patch.removed.includes(id),
      );
      const events = removed.event.removed;
      const blocks = blockIds.filter((id) =>
        removed.block.removed.includes(id),
      );
      // Patches and events first, while the nodes they use are still in the
      // graph.
      const { runtime } = get();
      perform(
        Effect.gen(function* () {
          for (const patchId of cut) yield* runtime.deletePatch(patchId);
          for (const eventId of events) yield* runtime.deleteEvent(eventId);
          for (const blockId of blocks) yield* runtime.deleteBlock(blockId);
        }),
      );
    },

    removePatches: (patchIds) => {
      const before = get();
      if (send({ _tag: "RemovePatches", patchIds })._tag !== "Committed")
        return;

      const removed = entityChanges(before, get()).patch.removed;
      const cut = patchIds.filter((id) => removed.includes(id));
      const { runtime } = get();
      perform(Effect.forEach(cut, runtime.deletePatch, { discard: true }));
    },

    setParamValue: (paramId, value) => {
      const outcome = send({ _tag: "SetParamValue", paramId, value });
      if (outcome._tag === "Committed")
        perform(get().runtime.updateParam(paramId));
      return outcome._tag !== "Refused";
    },

    addAutomation: (paramId, event) => {
      const id = committed(
        send({
          _tag: "AddAutomation",
          paramId,
          automationId: crypto.randomUUID(),
          event,
        }),
      );
      if (id === undefined) return undefined;
      perform(get().runtime.updateParam(paramId));
      return id;
    },

    removeAutomation: (paramId, automationId) => {
      if (
        send({ _tag: "RemoveAutomation", paramId, automationId })._tag ===
        "Committed"
      )
        perform(get().runtime.updateParam(paramId));
    },

    // Fires an event's method once, now; see playArgs.
    playEvent: (eventId) => {
      if (send({ _tag: "PlayEvent", eventId })._tag !== "Committed") return;
      const play = playArgs(get(), eventId);
      if (play !== undefined)
        perform(get().runtime.runLeafMethod(play.methodId, play.args));
    },

    addEvent: (methodId, settings) => {
      const id = committed(
        send({
          _tag: "AddEvent",
          eventId: crypto.randomUUID(),
          methodId,
          settings,
        }),
      );
      if (id === undefined) return undefined;
      perform(get().runtime.updateEvent(id));
      return id;
    },

    // Changes a sequence's steps while it plays, without rebuilding it.
    setEventSteps: (eventId, steps) => {
      if (send({ _tag: "SetEventSteps", eventId, steps })._tag === "Committed")
        perform(get().runtime.updateEventLive(eventId));
    },

    updateEvent: (eventId, settings) => {
      if (send({ _tag: "UpdateEvent", eventId, settings })._tag === "Committed")
        perform(get().runtime.updateEvent(eventId));
    },

    removeEvent: (eventId) => {
      if (send({ _tag: "RemoveEvent", eventId })._tag === "Committed")
        perform(get().runtime.deleteEvent(eventId));
    },

    setTransport: ({ bpm }) => {
      const outcome = send({ _tag: "SetTransport", bpm });
      if (outcome._tag === "Committed") perform(get().runtime.updateTransport);
      return outcome._tag !== "Refused";
    },

    // Queued behind any Run still rendering, so a Stop clicked straight after
    // Run cannot be overtaken by it.
    stop: () => {
      send({ _tag: "Stop" });
      running = running
        .then(() => Effect.runPromise(get().runtime.stop))
        .catch((error) => console.warn(error));
    },

    // Starts audio and builds the rack's Tone.js graph, rebuilding it from
    // scratch if it is already running. Audio starts in the sandbox frame,
    // which asks for a click of its own when the browser will not let it
    // start.
    run: () => {
      send({ _tag: "Run" });
      running = running
        .then(() => Effect.runPromise(get().runtime.render))
        .catch((error) => console.warn(error));
    },
  };
});
