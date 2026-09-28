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
