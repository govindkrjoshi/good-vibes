import { Schema } from "effect";

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

const BaseBlockFields = {
  id: Schema.String,
  name: Schema.String,
  parentId: Schema.optionalKey(Schema.String),
  jackIds: Schema.Array(Schema.String),
  paramIds: Schema.Array(Schema.String),
};

const AtomicBlock = Schema.Struct({
  ...BaseBlockFields,
  type: Schema.Literal("atomic"),
  code: Schema.String,
});

const CompositeBlock = Schema.Struct({
  ...BaseBlockFields,
  type: Schema.Literal("composite"),
  children: Schema.Array(Schema.String),
});

const Block = Schema.Union([AtomicBlock, CompositeBlock]);
const RackSchema = Schema.Struct({
  blocks: Schema.Array(Block),
  patches: Schema.Array(PatchSchema),
});

export type Rack = typeof RackSchema;
export type Jack = typeof JackSchema;
export type Param = typeof ParamSchema;
