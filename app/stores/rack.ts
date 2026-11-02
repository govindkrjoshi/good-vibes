import { castDraft, type Draft } from "immer";

import type { SliceCreator, Store } from "./common";
import type { CatalogueItem } from "../catalogue";
import {
  canPatch,
  flattenParams,
  isInside,
  patchScope,
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
  readonly moveRack: (rackId: string, parentId: string) => void;
  readonly addJack: (rackId: string, direction: Jack["direction"]) => void;
  readonly removeJack: (jackId: string) => void;
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

// Takes patches out of the store and out of the trees that hold them.
const dropPatches = (state: Draft<Store>, patchIds: readonly string[]) => {
  if (patchIds.length === 0) return;
  for (const id of patchIds) delete state.rack.patches[id];
  for (const rack of Object.values(state.rack.racks)) {
    if (rack.type === "tree") {
      rack.patches = rack.patches.filter((id) => !patchIds.includes(id));
    }
  }
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
  // A patch that can't reach across the rack's new place goes.
  moveRack: (rackId, parentId) =>
    set(
      (state) => {
        const { racks } = state.rack;
        const rack = racks[rackId];
        const parent = racks[parentId];
        if (
          rack === undefined ||
          rack.isRoot ||
          parent?.type !== "tree" ||
          rackId === parentId ||
          isInside(racks as Record<string, Rack>, parentId, rackId)
        ) {
          state.rack.errors.push(`${rackId} can't be moved to ${parentId}`);
          return;
        }
        if (rack.parentId === parentId) return;

        const held =
          rack.parentId === undefined ? undefined : racks[rack.parentId];
        if (held?.type === "tree") {
          held.children = held.children.filter((id) => id !== rackId);
        }
        rack.parentId = parentId;
        parent.children.push(rackId);

        const { jacks, patches } = state.rack;
        const stale = Object.values(patches).filter((patch) => {
          const from = jacks[patch.from];
          const to = jacks[patch.to];
          return (
            (from?.belongToBlockId === rackId ||
              to?.belongToBlockId === rackId) &&
            (from === undefined ||
              to === undefined ||
              !canPatch(racks as Record<string, Rack>, from, to))
          );
        });
        dropPatches(
          state,
          stale.map((patch) => patch.id),
        );
      },
      false,
      "rack/moveRack",
    ),
  // Only a tree's jacks are the user's to change: a leaf's are what its code has.
  addJack: (rackId, direction) =>
    set(
      (state) => {
        const rack = state.rack.racks[rackId];
        if (rack?.type !== "tree") {
          state.rack.errors.push(
            `${rackId} is not a tree rack, so its jacks can't change`,
          );
          return;
        }
        const label = direction === "in" ? "In" : "Out";
        const taken = new Set(
          rack.jackIds.map((id) => state.rack.jacks[id]?.name),
        );
        let number = 1;
        while (taken.has(`${label} ${number}`)) number += 1;

        const id = `${rackId}:${direction}:${crypto.randomUUID()}`;
        state.rack.jacks[id] = {
          id,
          name: `${label} ${number}`,
          belongToBlockId: rackId,
          direction,
        };
        rack.jackIds.push(id);
      },
      false,
      "rack/addJack",
    ),
  // Every patch to the jack goes with it.
  removeJack: (jackId) =>
    set(
      (state) => {
        const { jacks, patches, racks } = state.rack;
        const jack = jacks[jackId];
        const rack = jack && racks[jack.belongToBlockId];
        if (rack?.type !== "tree") {
          state.rack.errors.push(`${jackId} is not a jack on a tree rack`);
          return;
        }
        rack.jackIds = rack.jackIds.filter((id) => id !== jackId);
        delete jacks[jackId];

        dropPatches(
          state,
          Object.values(patches)
            .filter((patch) => patch.from === jackId || patch.to === jackId)
            .map((patch) => patch.id),
        );
      },
      false,
      "rack/removeJack",
    ),
  canConnectJacks: (fromJackId, toJackId) => {
    const { jacks, racks } = get().rack;
    const from = jacks[fromJackId];
    const to = jacks[toJackId];
    return from !== undefined && to !== undefined && canPatch(racks, from, to);
  },
  // A jack takes any number of patches, but only one between the same two jacks.
  connectJacks: (fromJackId, toJackId) =>
    set(
      (state) => {
        const { jacks, patches, racks } = state.rack;
        const from = jacks[fromJackId];
        const to = jacks[toJackId];
        const scopeId =
          from === undefined || to === undefined
            ? undefined
            : patchScope(racks as Record<string, Rack>, from, to);
        const scope = scopeId === undefined ? undefined : racks[scopeId];
        if (from === undefined || to === undefined || scope?.type !== "tree") {
          state.rack.errors.push(
            `${fromJackId} can't be patched to ${toJackId}`,
          );
          return;
        }
        const taken = Object.values(patches).some(
          (patch) => patch.from === from.id && patch.to === to.id,
        );
        if (taken) return;

        const id = crypto.randomUUID();
        patches[id] = {
          id,
          name: `${from.name} to ${to.name}`,
          from: from.id,
          to: to.id,
        };
        scope.patches.push(id);
      },
      false,
      "rack/connectJacks",
    ),
  // A tree takes everything under it along, and every patch to a removed
  // rack goes with it. The root rack is never removed.
  removeRacks: (_rackIds) => set((state) => state, false, "rack/removeRacks"),
  removePatches: (patchIds) =>
    set(
      (state) => {
        dropPatches(state, patchIds);
      },
      false,
      "rack/removePatches",
    ),
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
