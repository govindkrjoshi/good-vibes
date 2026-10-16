import type { RackState } from "./model";

// The things in a rack that can be told apart by id, and what changed among
// them between two states. The store never mutates, so an entity whose parts
// are the same objects in both states has not changed.
//
// Jacks and methods are made and dropped with their block, so they are not
// entities of their own. A param's value and automation belong to the param.

export type EntityKind = "block" | "patch" | "event" | "param" | "transport";

export const entityKinds: readonly EntityKind[] = [
  "block",
  "patch",
  "event",
  "param",
  "transport",
];

// The transport is the one entity there is only ever one of.
export const transportId = "transport";

export type EntityChange = {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
};

export type EntityChanges = Readonly<Record<EntityKind, EntityChange>>;

type Table = {
  readonly ids: (state: RackState) => readonly string[];
  readonly same: (before: RackState, after: RackState, id: string) => boolean;
};

const tables: Readonly<Record<EntityKind, Table>> = {
  block: {
    ids: (state) => Object.keys(state.blocks),
    same: (before, after, id) => before.blocks[id] === after.blocks[id],
  },
  patch: {
    ids: (state) => Object.keys(state.patches),
    same: (before, after, id) => before.patches[id] === after.patches[id],
  },
  event: {
    ids: (state) => Object.keys(state.events),
    same: (before, after, id) => before.events[id] === after.events[id],
  },
  param: {
    ids: (state) => Object.keys(state.params),
    same: (before, after, id) =>
      before.params[id] === after.params[id] &&
      before.values[id] === after.values[id] &&
      before.automations[id] === after.automations[id],
  },
  transport: {
    ids: () => [transportId],
    same: (before, after) => before.transport === after.transport,
  },
};

const changeIn = (
  table: Table,
  before: RackState,
  after: RackState,
): EntityChange => {
  const was = table.ids(before);
  const is = table.ids(after);
  const wasSet = new Set(was);
  const isSet = new Set(is);
  return {
    added: is.filter((id) => !wasSet.has(id)),
    changed: is.filter(
      (id) => wasSet.has(id) && !table.same(before, after, id),
    ),
    removed: was.filter((id) => !isSet.has(id)),
  };
};

export const entityChanges = (
  before: RackState,
  after: RackState,
): EntityChanges =>
  Object.fromEntries(
    entityKinds.map((kind) => [kind, changeIn(tables[kind], before, after)]),
  ) as EntityChanges;

export const hasChanges = (changes: EntityChanges): boolean =>
  entityKinds.some((kind) => {
    const { added, changed, removed } = changes[kind];
    return added.length + changed.length + removed.length > 0;
  });
