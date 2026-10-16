import { createStore } from "zustand";
import type { RackEnvelope } from "./messages";
import { rootRack, type RackState } from "./model";
import {
  initialRackMeta,
  reduceAll,
  type Outcome,
  type RackCore,
  type RackWork,
} from "./reduce";

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
};

// Listeners for triggers the store accepts: work for the sandbox that leaves
// the rack as it is, so watching the rack alone would miss it.
const workListeners = new Set<(work: readonly RackWork[]) => void>();

// Listeners for every dispatch, whatever came of it, for the dev log.
export type Dispatched = {
  readonly envelopes: readonly RackEnvelope[];
  readonly outcomes: readonly Outcome[];
  readonly rev: number;
  readonly workSeq: number;
};

const dispatchListeners = new Set<(dispatched: Dispatched) => void>();

export const onDispatch = (
  listener: (dispatched: Dispatched) => void,
): (() => void) => {
  dispatchListeners.add(listener);
  return () => dispatchListeners.delete(listener);
};

// How many are listening, for checking nothing is left subscribed.
export const workListenerCount = () => workListeners.size;

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
    if (dispatchListeners.size > 0) {
      const dispatched = {
        envelopes,
        outcomes,
        rev: state.rev,
        workSeq: state.workSeq,
      };
      for (const listener of dispatchListeners) listener(dispatched);
    }
    return outcomes;
  };
  const dispatch = (envelope: RackEnvelope): Outcome =>
    dispatchAll([envelope])[0] ?? { _tag: "Unchanged" };

  return {
    ...initialRackState,
    ...initialRackMeta,
    dispatch,
    dispatchAll,
  };
});
