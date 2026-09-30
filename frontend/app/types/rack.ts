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

const RackSchema = Schema.Union([LeafRack, TreeRack]);

export type Rack = Schema.Schema.Type<typeof RackSchema>;
export type Jack = Schema.Schema.Type<typeof JackSchema>;
export type Param = Schema.Schema.Type<typeof ParamSchema>;
export type Patch = Schema.Schema.Type<typeof PatchSchema>;
export type Code = Schema.Schema.Type<typeof CodeSchema>;

export type TreeBlock = Schema.Schema.Type<typeof TreeRack>;

export const rootRack: TreeBlock = TreeRack.make({
  id: "root",
  name: "Root",
  type: "tree",
  isRoot: true,
  jackIds: [],
  paramIds: [],
  children: [],
  patches: [],
});

/** The input and output jacks every new block starts with. */
export const makeDefaultJacks = (blockId: string): readonly [Jack, Jack] => [
  {
    id: `${blockId}:in`,
    name: "Input",
    belongToBlockId: blockId,
    direction: "in",
  },
  {
    id: `${blockId}:out`,
    name: "Output",
    belongToBlockId: blockId,
    direction: "out",
  },
];

/**
 * Whether `block` has an output jack to wire out of. Only the rack can answer
 * this: a block holds jack ids and the directions live in the jack table, so a
 * block schema on its own can do no better than match on how an id is spelled.
 * The root is exempt, having nothing above it to wire into.
 */
export const hasOutputJack = (
  block: Rack,
  jacks: Record<string, Jack>,
): boolean =>
  block.isRoot || block.jackIds.some((id) => jacks[id]?.direction === "out");

/**
 * Whether a patch may run from `from` to `to` under `root`: an output jack on
 * one of its children wired to an input jack on a different one. The store
 * checks this before it stores a patch and the canvas checks it again before it
 * draws one, so the two cannot drift apart on what counts as a patch.
 */
export const canPatch = (root: TreeBlock, from: Jack, to: Jack): boolean =>
  from.direction === "out" &&
  to.direction === "in" &&
  from.belongToBlockId !== to.belongToBlockId &&
  root.children.includes(from.belongToBlockId) &&
  root.children.includes(to.belongToBlockId);

/** A fresh block, parented to `parentId`. Groups nest; nodes hold code. */
export const makeBlock = (
  id: string,
  parentId: string,
  blockType: "node" | "tree",
): Rack => {
  const shared = {
    id,
    isRoot: false,
    parentId,
    jackIds: makeDefaultJacks(id).map((jack) => jack.id),
    paramIds: [],
  };

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
