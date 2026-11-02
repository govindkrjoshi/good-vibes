import type { RackState } from "./model";

// One change to a RackState. Records are walked key by key; anything else,
// arrays included, is replaced whole.
export type RackOp =
  | {
      readonly op: "set";
      readonly path: readonly string[];
      readonly value: unknown;
    }
  | { readonly op: "delete"; readonly path: readonly string[] };

type Dict = Readonly<Record<string, unknown>>;

const isDict = (value: unknown): value is Dict =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// What a sandbox holds before it hears anything, so the whole rack can be sent
// as a diff against it.
export const emptyRackState: RackState = {
  racks: {},
  jacks: {},
  paramGroups: {},
  methods: {},
  values: {},
  automations: {},
  patches: {},
  events: {},
  transport: { bpm: 120, playing: false },
  rootId: "root",
};

const fields = Object.keys(emptyRackState) as (keyof RackState)[];

const walk = (
  prev: unknown,
  next: unknown,
  path: readonly string[],
): RackOp[] => {
  // Immer keeps what didn't change, so most of the state stops here.
  if (Object.is(prev, next)) return [];
  if (!isDict(prev) || !isDict(next)) {
    return [{ op: "set", path, value: next }];
  }
  return [
    ...Object.keys(prev)
      .filter((key) => !(key in next))
      .map((key): RackOp => ({ op: "delete", path: [...path, key] })),
    ...Object.keys(next).flatMap((key) =>
      key in prev
        ? walk(prev[key], next[key], [...path, key])
        : [{ op: "set" as const, path: [...path, key], value: next[key] }],
    ),
  ];
};

// Reads only the rack's data: a slice's actions and errors never cross over.
export const diffRack = (prev: RackState, next: RackState): RackOp[] =>
  fields.flatMap((field) => walk(prev[field], next[field], [field]));

const applyOp = (
  held: unknown,
  [key, ...rest]: readonly string[],
  op: RackOp,
): unknown => {
  if (key === undefined) return op.op === "set" ? op.value : undefined;
  const dict = isDict(held) ? held : {};
  if (rest.length === 0 && op.op === "delete") {
    const { [key]: _gone, ...kept } = dict;
    return kept;
  }
  return { ...dict, [key]: applyOp(dict[key], rest, op) };
};

export const applyRackOps = (
  state: RackState,
  ops: readonly RackOp[],
): RackState =>
  ops.reduce<unknown>(
    (held, op) => applyOp(held, op.path, op),
    state,
  ) as RackState;
