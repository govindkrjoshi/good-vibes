import { castDraft, type Draft } from "immer";

import type { SliceCreator, Store } from "./common";
import type { CatalogueItem } from "../catalogue";
import {
  canPatch,
  flattenParams,
  rackParams,
  rootRack,
  type AutomationEvent,
  type EventSettings,
  type Jack,
  type ParamValue,
  type Rack,
  type RackEvent,
  type RackState,
  type Transport,
} from "../rack/model";

// Actions here only change state; they don't check what they are given. A
// value, event or automation that does not fit is meant to be caught by
// describing the whole state as an Effect schema and validating against it.
// See docs/state-validation.md.
type State = RackState & {
  readonly errors: string[];
};

type Actions = {
  readonly addRack: (rack: Rack, parentId: string) => void;
  readonly addRackFromCatalogue: (
    category: string,
    name: string,
    parentId: string,
    id?: string,
  ) => void;
  readonly canConnectJacks: (fromJackId: string, toJackId: string) => boolean;
  readonly connectJacks: (fromJackId: string, toJackId: string) => void;
  readonly removeRacks: (rackIds: readonly string[]) => void;
  readonly removePatches: (patchIds: readonly string[]) => void;
  readonly setParamValue: (paramId: string, value: ParamValue) => void;
  readonly addAutomation: (
    paramId: string,
    event: Omit<AutomationEvent, "id">,
  ) => string | undefined;
  readonly removeAutomation: (paramId: string, eventId: string) => void;
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
  readonly setTransport: (transport: Transport) => void;
  readonly reset: () => void;
};

export type RackSlice = State & Actions;

const initialState: State = {
  racks: { [rootRack.id]: rootRack },
  jacks: {},
  paramGroups: {},
  methods: {},
  values: {},
  automations: {},
  patches: {},
  events: {},
  transport: { bpm: 120 },
  rootId: "root",
  errors: [],
};

// Every id a catalogue item owns starts with its rack's id, so swapping that
// prefix gives a copy that can sit beside other copies of the same item. Only
// plain objects and arrays are walked, which leaves the rack's code alone.
const rekey = (value: unknown, from: string, to: string): unknown => {
  if (typeof value === "string") {
    return value === from || value.startsWith(`${from}:`)
      ? to + value.slice(from.length)
      : value;
  }
  if (Array.isArray(value)) return value.map((v) => rekey(v, from, to));
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        rekey(k, from, to),
        rekey(v, from, to),
      ]),
    );
  }
  return value;
};

const withRackId = (item: CatalogueItem, id: string): CatalogueItem =>
  rekey(item, item.rack.id, id) as CatalogueItem;

// Puts a rack in the store as a child of its parent, which has to be a tree.
// Returns whether it was added, so the caller can add what the rack owns.
const addToParent = (
  state: Draft<Store>,
  rack: Rack,
  parentId: string,
): boolean => {
  const parent = state.rack.racks[parentId];
  if (parent?.type !== "tree") {
    state.rack.errors.push(
      `${rack.name} can't be added to ${parentId}, which is not a tree rack`,
    );
    return false;
  }
  state.rack.racks[rack.id] = castDraft({ ...rack, parentId });
  if (!parent.children.includes(rack.id)) parent.children.push(rack.id);
  return true;
};

export const createRackSlice: SliceCreator<RackSlice> = (set, get) => ({
  ...initialState,
  reset: () =>
    set(
      (state) => {
        Object.assign(state.rack, initialState);
      },
      false,
      "rack/reset",
    ),
  addRack: (rack, parentId) =>
    set(
      (state) => {
        addToParent(state, rack, parentId);
      },
      false,
      "rack/addRack",
    ),
  canConnectJacks: (_fromJackId, _toJackId) => false,
  connectJacks: (_fromJackId, _toJackId) =>
    set((state) => state, false, "rack/connectJacks"),
  // A tree takes everything under it along, and every patch to a removed
  // rack goes with it. The root rack is never removed.
  removeRacks: (_rackIds) => set((state) => state, false, "rack/removeRacks"),
  removePatches: (_patchIds) =>
    set((state) => state, false, "rack/removePatches"),
  setParamValue: (paramId, value) =>
    set(
      (state) => {
        state.rack.values[paramId] = value;
      },
      false,
      "rack/setParamValue",
    ),
  addAutomation: (paramId, event) => {
    const id = crypto.randomUUID();
    set(
      (state) => {
        (state.rack.automations[paramId] ??= []).push({ ...event, id });
      },
      false,
      "rack/addAutomation",
    );
    return id;
  },
  removeAutomation: (paramId, eventId) =>
    set(
      (state) => {
        const held = state.rack.automations[paramId];
        if (held === undefined) return;
        state.rack.automations[paramId] = held.filter(
          (event) => event.id !== eventId,
        );
      },
      false,
      "rack/removeAutomation",
    ),
  addEvent: (_methodId, _settings) => {
    set((state) => state, false, "rack/addEvent");
    return "foo";
  },
  setEventSteps: (eventId, steps) =>
    set(
      (state) => {
        const event = state.rack.events[eventId];
        if (event?.kind !== "sequence") return;
        event.steps = [...steps];
      },
      false,
      "rack/setEventSteps",
    ),
  updateEvent: (eventId, settings) =>
    set(
      (state) => {
        const held = state.rack.events[eventId];
        if (held === undefined) return;
        state.rack.events[eventId] = castDraft({
          ...held,
          ...settings,
        } as RackEvent);
      },
      false,
      "rack/updateEvent",
    ),
  removeEvent: (eventId) =>
    set(
      (state) => {
        const event = state.rack.events[eventId];
        if (event === undefined) return;
        const owner = state.rack.racks[event.belongToBlockId];
        if (owner !== undefined) {
          owner.eventIds = owner.eventIds.filter((id) => id !== eventId);
        }
        delete state.rack.events[eventId];
      },
      false,
      "rack/removeEvent",
    ),
  setTransport: ({ bpm }) =>
    set(
      (state) => {
        state.rack.transport = { bpm };
      },
      false,
      "rack/setTransport",
    ),
  addRackFromCatalogue: (
    category,
    name,
    parentId,
    id = crypto.randomUUID(),
  ) => {
    const found = get().catalogue.findByCategoryAndName(category, name);
    const item = found && withRackId(found, id);
    set(
      (state) => {
        if (!item) {
          state.rack.errors.push(`${category} ${name} is not in the catalogue`);
          return;
        }
        if (!addToParent(state, item.rack, parentId)) return;

        const params = flattenParams(item.paramGroup);
        state.rack.paramGroups[item.paramGroup.id] = castDraft(item.paramGroup);
        Object.assign(state.rack.jacks, item.jacks);
        Object.assign(state.rack.methods, item.methods);
        Object.assign(state.rack.events, item.events);
        for (const param of params) {
          state.rack.values[param.id] = param.defaultValue;
        }
      },
      false,
      "rack/addRackFromCatalogue",
    );
  },
});
