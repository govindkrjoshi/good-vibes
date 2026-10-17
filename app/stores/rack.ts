import { castDraft, type Draft } from "immer";

import type { SliceCreator, Store } from "./common";
import type { CatalogueItem } from "../catalogue";
import { inputJack, outputJack } from "../catalogue/common";
import {
  canPatch,
  flattenParams,
  makeBlock,
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
  readonly addBlock: (blockType: "leaf" | "tree", parentId: string) => void;
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

// A patch lives in the tree that holds both racks it joins, so the jacks have
// to be an output and an input on two children of the same tree.
const resolvePatch = (
  state: Pick<State, "jacks" | "racks">,
  fromJackId: string,
  toJackId: string,
):
  | { readonly parentId: string; readonly from: Jack; readonly to: Jack }
  | undefined => {
  const from = state.jacks[fromJackId];
  const to = state.jacks[toJackId];
  const parentId = from && state.racks[from.belongToBlockId]?.parentId;
  const parent = parentId === undefined ? undefined : state.racks[parentId];
  if (!from || !to || parent?.type !== "tree" || !canPatch(parent, from, to)) {
    return undefined;
  }
  return { parentId: parent.id, from, to };
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
  addBlock: (blockType, parentId) =>
    set(
      (state) => {
        const block = makeBlock(crypto.randomUUID(), parentId, blockType);
        if (!addToParent(state, block, parentId)) return;
        for (const jack of [inputJack(block.id), outputJack(block.id)]) {
          state.rack.jacks[jack.id] = jack;
        }
      },
      false,
      "rack/addBlock",
    ),
  canConnectJacks: (fromJackId, toJackId) =>
    resolvePatch(get().rack, fromJackId, toJackId) !== undefined,
  connectJacks: (fromJackId, toJackId) =>
    set(
      (state) => {
        const resolved = resolvePatch(state.rack, fromJackId, toJackId);
        if (!resolved) {
          state.rack.errors.push(
            `${fromJackId} can't be patched to ${toJackId}`,
          );
          return;
        }
        const { parentId, from, to } = resolved;
        const parent = state.rack.racks[parentId];
        if (parent?.type !== "tree") return;

        // React Flow reports a connection for every drag that lands, so the
        // same pair of jacks can arrive more than once. Two patches between
        // one pair would draw as two edges stacked on the same line.
        const held = parent.patches.some((id) => {
          const patch = state.rack.patches[id];
          return patch?.from === from.id && patch.to === to.id;
        });
        if (held) return;

        const id = crypto.randomUUID();
        state.rack.patches[id] = {
          id,
          name: `${from.name} → ${to.name}`,
          from: from.id,
          to: to.id,
        };
        parent.patches.push(id);
      },
      false,
      "rack/connectJacks",
    ),
  // A tree takes everything under it along, and every patch to a removed
  // rack goes with it. The root rack is never removed.
  removeRacks: (rackIds) =>
    set(
      (state) => {
        const { rack } = state;
        const doomed = new Set<string>();
        const doom = (id: string) => {
          const held = rack.racks[id];
          if (held === undefined || held.isRoot || doomed.has(id)) return;
          doomed.add(id);
          if (held.type === "tree") held.children.forEach(doom);
        };
        rackIds.forEach(doom);
        if (doomed.size === 0) return;

        const doomedJack = (jackId: string) => {
          const owner = rack.jacks[jackId]?.belongToBlockId;
          return owner !== undefined && doomed.has(owner);
        };
        const cut = new Set(
          Object.values(rack.patches)
            .filter((patch) => doomedJack(patch.from) || doomedJack(patch.to))
            .map((patch) => patch.id),
        );
        const paramIds = [...doomed].flatMap((id) =>
          rackParams(rack, id).map((param) => param.id),
        );

        for (const held of Object.values(rack.racks)) {
          if (held.type !== "tree" || doomed.has(held.id)) continue;
          held.children = held.children.filter((id) => !doomed.has(id));
          held.patches = held.patches.filter((id) => !cut.has(id));
        }
        for (const id of doomed) {
          const groupId = rack.racks[id]?.paramGroupId;
          if (groupId !== undefined) delete rack.paramGroups[groupId];
          delete rack.racks[id];
        }
        for (const id of cut) delete rack.patches[id];
        for (const id of paramIds) {
          delete rack.values[id];
          delete rack.automations[id];
        }
        for (const [id, jack] of Object.entries(rack.jacks)) {
          if (doomed.has(jack.belongToBlockId)) delete rack.jacks[id];
        }
        for (const [id, method] of Object.entries(rack.methods)) {
          if (doomed.has(method.belongToBlockId)) delete rack.methods[id];
        }
        for (const [id, event] of Object.entries(rack.events)) {
          if (doomed.has(event.belongToBlockId)) delete rack.events[id];
        }
      },
      false,
      "rack/removeRacks",
    ),
  removePatches: (patchIds) =>
    set(
      (state) => {
        const cut = new Set(patchIds);
        for (const held of Object.values(state.rack.racks)) {
          if (held.type !== "tree") continue;
          held.patches = held.patches.filter((id) => !cut.has(id));
        }
        for (const id of cut) delete state.rack.patches[id];
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
  addEvent: (methodId, settings) => {
    const { methods, racks } = get().rack;
    const method = methods[methodId];
    if (method === undefined) return undefined;

    if (racks[method.belongToBlockId] === undefined) return undefined;

    const id = crypto.randomUUID();
    const event = {
      ...settings,
      methodId,
      id,
      belongToBlockId: method.belongToBlockId,
    } as RackEvent;

    set(
      (state) => {
        state.rack.racks[method.belongToBlockId]?.eventIds.push(id);
        state.rack.events[id] = castDraft(event);
      },
      false,
      "rack/addEvent",
    );
    return id;
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
