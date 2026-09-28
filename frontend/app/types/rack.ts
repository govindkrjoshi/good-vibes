import { Effect, Schema } from "effect";

const JackSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  belongToBlockId: Schema.String,
  direction: Schema.Enum({ in: "in", out: "out" }),
});

const PatchSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  from: Schema.String,
  to: Schema.String,
});

const ParamSchema = Schema.Struct({});

const CodeSchema = Schema.declare(Effect.isEffect, {
  title: "Code",
  description: "The Effect a node block runs",
});

const BaseBlockFields = {
  id: Schema.String,
  name: Schema.String,
  isRoot: Schema.Boolean,
  parentId: Schema.optionalKey(Schema.String),
  jackIds: Schema.Array(Schema.String),
  paramIds: Schema.Array(Schema.String),
};

const EmptyRack = Schema.Struct({
  ...BaseBlockFields,
  type: Schema.Literal("empty"),
});

const LeafRack = Schema.Struct({
  ...BaseBlockFields,
  type: Schema.Literal("node"),
  code: CodeSchema,
});

const TreeRack = Schema.Struct({
  ...BaseBlockFields,
  type: Schema.Literal("tree"),
  children: Schema.Array(Schema.String),
  patches: Schema.Array(Schema.String),
});

const RackSchema = Schema.Union([EmptyRack, LeafRack, TreeRack]);

export type Rack = Schema.Schema.Type<typeof RackSchema>;
export type Jack = Schema.Schema.Type<typeof JackSchema>;
export type Param = Schema.Schema.Type<typeof ParamSchema>;
export type Patch = Schema.Schema.Type<typeof PatchSchema>;
export type Code = Schema.Schema.Type<typeof CodeSchema>;

export const emptyRack: Rack = EmptyRack.make({
  id: "root",
  name: "empty",
  type: "empty",
  isRoot: true,
  jackIds: [],
  paramIds: [],
});

export type TreeBlock = Schema.Schema.Type<typeof TreeRack>;

/** A fresh block, parented to `parentId`. Groups nest; nodes hold code. */
export const makeBlock = (
  id: string,
  parentId: string,
  blockType: "node" | "tree",
): Rack => {
  const shared = { id, isRoot: false, parentId, jackIds: [], paramIds: [] };

  return blockType === "tree"
    ? TreeRack.make({
        ...shared,
        name: "Group",
        type: "tree",
        children: [],
        patches: [],
      })
    : LeafRack.make({
        ...shared,
        name: "Node",
        type: "node",
        // A new node runs nothing until the editor gives it code. `make`
        // checks this really is an Effect, so a null placeholder would throw.
        code: Effect.void,
      });
};

/**
 * Rebuilds a block as a tree, keeping its identity. Adding the first block to
 * an empty rack goes through here: the root keeps its id, so `rootId` and any
 * `parentId` pointing at it stay valid.
 */
export const toTree = (
  block: Rack,
  children: readonly string[],
  patches: readonly string[],
): TreeBlock =>
  TreeRack.make({
    id: block.id,
    name: block.name,
    type: "tree",
    isRoot: block.isRoot,
    // `optionalKey` rejects an explicit `undefined`, so omit the key instead.
    ...(block.parentId === undefined ? {} : { parentId: block.parentId }),
    jackIds: block.jackIds,
    paramIds: block.paramIds,
    children,
    patches,
  });
