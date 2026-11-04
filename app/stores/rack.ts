import { castDraft, type Draft } from "immer";

import type { SliceCreator, Store } from "./common";
import { instantiate, type Instance, type ItemSpec } from "../catalogue";
import {
  canPatch,
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
  // `itemKey` is `pluginId/name`, as the catalogue's registry has it.
  readonly addRackFromCatalogue: (
    itemKey: string,
    parentId: string,
    id?: string,
  ) => void;
  // Places an item spec as a leaf with everything it owns. `item` is the
  // catalogue key it came from, if any; a spec written on the spot has none.
  readonly addItem: (
    spec: ItemSpec,
    parentId: string,
    id?: string,
    item?: string,
  ) => void;
  // Makes a leaf over again from a spec, keeping its place, the values of
  // params it still has, the patches to jacks it still has, and the events
  // added to it since it was placed whose method it still has.
  readonly replaceItem: (rackId: string, spec: ItemSpec, item?: string) => void;
  readonly moveRack: (rackId: string, parentId: string) => void;
  // Returns the new jack's id, or nothing when the rack is not a tree.
  readonly addJack: (
    rackId: string,
    direction: Jack["direction"],
    name?: string,
  ) => string | undefined;
  readonly removeJack: (jackId: string) => void;
  readonly canConnectJacks: (fromJackId: string, toJackId: string) => boolean;
  // Returns the patch between the jacks, made now or already there.
  readonly connectJacks: (
    fromJackId: string,
    toJackId: string,
  ) => string | undefined;
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
  readonly setTransport: (transport: Partial<Transport>) => void;
  readonly reportError: (message: string) => void;
  readonly reset: () => void;
  // Takes every rack and patch away, keeping the tempo.
  readonly clear: () => void;
  // Puts a whole rack in place of the current one, as a demo or a saved rack.
  readonly load: (state: RackState) => void;
};

export type RackSlice = State & Actions;

export const initialRack: State = {
  racks: { [rootRack.id]: rootRack },
  jacks: {},
  paramGroups: {},
  methods: {},
  values: {},
  automations: {},
  patches: {},
  events: {},
  transport: { bpm: 120, playing: false },
  rootId: "root",
  errors: [],
};

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
  if (state.rack.racks[rack.id] !== undefined) {
    state.rack.errors.push(`there is already a rack ${rack.id}`);
    return false;
  }
  state.rack.racks[rack.id] = castDraft({ ...rack, parentId });
  if (!parent.children.includes(rack.id)) parent.children.push(rack.id);
  return true;
};

// Puts everything an instance owns in the store, under its parent.
const placeInstance = (
  state: Draft<Store>,
  item: Instance,
  parentId: string,
): boolean => {
  if (!addToParent(state, item.rack, parentId)) return false;
  state.rack.paramGroups[item.paramGroup.id] = castDraft(item.paramGroup);
  Object.assign(state.rack.jacks, item.jacks);
  Object.assign(state.rack.methods, item.methods);
  Object.assign(state.rack.events, item.events);
  Object.assign(state.rack.values, item.values);
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
  ...initialRack,
  reset: () =>
    set(
      (state) => {
        Object.assign(state.rack, initialRack);
      },
      false,
      "rack/reset",
    ),
  clear: () =>
    set(
      (state) => {
        const { transport } = state.rack;
        Object.assign(state.rack, initialRack, {
          transport: { ...transport, playing: false },
        });
      },
      false,
      "rack/clear",
    ),
  load: (next) =>
    set(
      (state) => {
        Object.assign(state.rack, castDraft(next), { errors: [] });
      },
      false,
      "rack/load",
    ),
  // A rack names its jacks by id, as `${rackId}:in` or `${rackId}:out`, with
  // anything after that telling apart jacks that share a direction. Any of
  // them not in the store yet is made from its id.
  addRack: (rack, parentId) =>
    set(
      (state) => {
        if (!addToParent(state, rack, parentId)) return;
        for (const id of rack.jackIds) {
          if (state.rack.jacks[id] !== undefined) continue;
          const direction = id.slice(rack.id.length + 1).split(":")[0];
          if (direction !== "in" && direction !== "out") {
            state.rack.errors.push(`${id} is not an in or out jack`);
            continue;
          }
          state.rack.jacks[id] = {
            id,
            name: direction === "in" ? "Input" : "Output",
            belongToBlockId: rack.id,
            direction,
          };
        }
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
  addJack: (rackId, direction, name) => {
    const id = `${rackId}:${direction}:${crypto.randomUUID()}`;
    let added = false;
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

        state.rack.jacks[id] = {
          id,
          name: name ?? `${label} ${number}`,
          belongToBlockId: rackId,
          direction,
        };
        rack.jackIds.push(id);
        added = true;
      },
      false,
      "rack/addJack",
    );
    return added ? id : undefined;
  },
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
  connectJacks: (fromJackId, toJackId) => {
    let patchId: string | undefined;
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
        const taken = Object.values(patches).find(
          (patch) => patch.from === from.id && patch.to === to.id,
        );
        if (taken !== undefined) {
          patchId = taken.id;
          return;
        }

        const id = crypto.randomUUID();
        patches[id] = {
          id,
          name: `${from.name} to ${to.name}`,
          from: from.id,
          to: to.id,
        };
        scope.patches.push(id);
        patchId = id;
      },
      false,
      "rack/connectJacks",
    );
    return patchId;
  },
  // A tree takes everything under it along, and every patch to a removed
  // rack goes with it. The root rack is never removed.
  removeRacks: (rackIds) =>
    set(
      (state) => {
        const { racks } = state.rack;
        const doomed = new Set<string>();
        const doom = (id: string) => {
          const rack = racks[id];
          if (rack === undefined || rack.isRoot || doomed.has(id)) return;
          doomed.add(id);
          if (rack.type === "tree") rack.children.forEach(doom);
        };
        rackIds.forEach(doom);
        if (doomed.size === 0) return;

        const owned = (held: { readonly belongToBlockId: string }) =>
          doomed.has(held.belongToBlockId);
        const { jacks, patches, methods, events, paramGroups } = state.rack;

        dropPatches(
          state,
          Object.values(patches)
            .filter((patch) =>
              [jacks[patch.from], jacks[patch.to]].some(
                (jack) => jack === undefined || owned(jack),
              ),
            )
            .map((patch) => patch.id),
        );
        for (const id of doomed) {
          for (const param of rackParams(state.rack, id)) {
            delete state.rack.values[param.id];
            delete state.rack.automations[param.id];
          }
          const { paramGroupId, parentId } = racks[id]!;
          if (paramGroupId !== undefined) delete paramGroups[paramGroupId];
          const parent = parentId === undefined ? undefined : racks[parentId];
          if (parent?.type === "tree") {
            parent.children = parent.children.filter((child) => child !== id);
          }
        }
        for (const jack of Object.values(jacks)) {
          if (owned(jack)) delete jacks[jack.id];
        }
        for (const method of Object.values(methods)) {
          if (owned(method)) delete methods[method.id];
        }
        for (const event of Object.values(events)) {
          if (owned(event)) delete events[event.id];
        }
        for (const id of doomed) delete racks[id];
      },
      false,
      "rack/removeRacks",
    ),
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
  // The event plays on the rack its method belongs to.
  addEvent: (methodId, settings) => {
    const method = get().rack.methods[methodId];
    const id = crypto.randomUUID();
    set(
      (state) => {
        const owner = method && state.rack.racks[method.belongToBlockId];
        if (owner === undefined) {
          state.rack.errors.push(`${methodId} is not a method on any rack`);
          return;
        }
        state.rack.events[id] = castDraft({
          ...settings,
          id,
          belongToBlockId: owner.id,
          methodId,
        } as RackEvent);
        owner.eventIds.push(id);
      },
      false,
      "rack/addEvent",
    );
    return method === undefined ? undefined : id;
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
  setTransport: (transport) =>
    set(
      (state) => {
        Object.assign(state.rack.transport, transport);
      },
      false,
      "rack/setTransport",
    ),
  reportError: (message) =>
    set(
      (state) => {
        state.rack.errors.push(message);
      },
      false,
      "rack/reportError",
    ),
  addRackFromCatalogue: (itemKey, parentId, id) => {
    const found = get().catalogue.findItem(itemKey);
    if (found === undefined) {
      get().rack.reportError(`${itemKey} is not in the catalogue`);
      return;
    }
    get().rack.addItem(found, parentId, id, found.key);
  },
  addItem: (spec, parentId, id = crypto.randomUUID(), item) => {
    const placed = instantiate(spec, id, item);
    set(
      (state) => {
        placeInstance(state, placed, parentId);
      },
      false,
      "rack/addItem",
    );
  },
  replaceItem: (rackId, spec, item) => {
    const next = instantiate(spec, rackId, item);
    set(
      (state) => {
        const held = state.rack.racks[rackId];
        if (held?.type !== "leaf" || held.parentId === undefined) {
          state.rack.errors.push(`${rackId} is not a leaf rack`);
          return;
        }
        const { jacks, patches, methods, events, values, automations } =
          state.rack;

        // Values and automation stay where the param is still there and the
        // value still fits; the rest start from the spec's defaults.
        const kept: Record<string, ParamValue> = {};
        for (const param of rackParams(state.rack, rackId)) {
          const value = values[param.id];
          const fresh = next.values[param.id];
          if (
            value !== undefined &&
            fresh !== undefined &&
            typeof value === typeof fresh
          ) {
            kept[param.id] = value;
          } else {
            delete automations[param.id];
          }
          delete values[param.id];
        }
        const oldGroupId = held.paramGroupId;
        if (oldGroupId !== undefined) delete state.rack.paramGroups[oldGroupId];
        state.rack.paramGroups[next.paramGroup.id] = castDraft(next.paramGroup);
        Object.assign(values, next.values, kept);

        // Patches to jacks the spec no longer has go with them.
        for (const id of held.jackIds) {
          if (next.jacks[id] === undefined) delete jacks[id];
        }
        Object.assign(jacks, next.jacks);
        dropPatches(
          state,
          Object.values(patches)
            .filter(
              (patch) =>
                jacks[patch.from] === undefined ||
                jacks[patch.to] === undefined,
            )
            .map((patch) => patch.id),
        );

        for (const id of held.methodIds) delete methods[id];
        Object.assign(methods, next.methods);

        // The spec's own events are replaced by the new spec's; events added
        // since stay while their method is still there.
        const survivors = held.eventIds.filter((id) => {
          const event = events[id];
          const own = id.startsWith(`${rackId}:event:`);
          const keep =
            event !== undefined &&
            !own &&
            next.methods[event.methodId] !== undefined;
          if (!keep) delete events[id];
          return keep;
        });
        Object.assign(events, next.events);

        state.rack.racks[rackId] = castDraft({
          ...next.rack,
          parentId: held.parentId,
          eventIds: [...survivors, ...next.rack.eventIds],
        });
      },
      false,
      "rack/replaceItem",
    );
  },
});
