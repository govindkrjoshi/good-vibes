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

const ParamValueSchema = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);

const ParamOptionSchema = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  value: ParamValueSchema,
});

const RampMethodSchema = Schema.Literals([
  "setValueAtTime",
  "rampTo",
  "linearRampToValueAtTime",
  "exponentialRampToValueAtTime",
]);

const ParamAutomationSchema = Schema.Struct({
  methods: Schema.Array(RampMethodSchema),
});

const BaseParamFields = {
  name: Schema.String,
  path: Schema.Array(Schema.String),
  order: Schema.optionalKey(Schema.Number),
  description: Schema.optionalKey(Schema.String),
};

const NumberParamSchema = Schema.Struct({
  ...BaseParamFields,
  kind: Schema.Literal("number"),
  defaultValue: Schema.Number,
  min: Schema.optionalKey(Schema.Number),
  max: Schema.optionalKey(Schema.Number),
  step: Schema.optionalKey(Schema.Number),
  unit: Schema.optionalKey(Schema.String),
  automation: Schema.optionalKey(ParamAutomationSchema),
});

const BooleanParamSchema = Schema.Struct({
  ...BaseParamFields,
  kind: Schema.Literal("boolean"),
  defaultValue: Schema.Boolean,
});

const TextParamSchema = Schema.Struct({
  ...BaseParamFields,
  kind: Schema.Literal("text"),
  defaultValue: Schema.String,
});

const SelectParamSchema = Schema.Struct({
  ...BaseParamFields,
  kind: Schema.Literal("select"),
  defaultValue: ParamValueSchema,
  options: Schema.Array(ParamOptionSchema),
});

const ParamSchema = Schema.Union([
  NumberParamSchema,
  BooleanParamSchema,
  TextParamSchema,
  SelectParamSchema,
]);

export type Param = Schema.Schema.Type<typeof ParamSchema>;

export interface ParamGroup {
  readonly name?: string;
  readonly params?: Readonly<Record<string, Param>>;
  readonly groups?: Readonly<Record<string, ParamGroup>>;
}

const ParamGroupSchema: Schema.Codec<ParamGroup> = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Record(Schema.String, ParamSchema)),
  groups: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<ParamGroup> => ParamGroupSchema),
    ),
  ),
});

const CodeSchema = Schema.declare(Effect.isEffect, {
  title: "Code",
  description: "The Effect a leaf block runs",
});

const MethodArgKindSchema = Schema.Literals([
  "boolean",
  "number",
  "text",
  "time",
  "note",
]);

const MethodArgSchema = Schema.Struct({
  name: Schema.String,
  kind: MethodArgKindSchema,
  optional: Schema.optionalKey(Schema.Boolean),
  defaultValue: Schema.optionalKey(ParamValueSchema),
  description: Schema.optionalKey(Schema.String),
});

const MethodSchema = Schema.Struct({
  name: Schema.String,
  method: Schema.String,
  description: Schema.optionalKey(Schema.String),
  args: Schema.Array(MethodArgSchema),
});

const BaseBlockFields = {
  id: Schema.String,
  name: Schema.String,
  isRoot: Schema.Boolean,
  parentId: Schema.optionalKey(Schema.String),
  jackIds: Schema.Array(Schema.String),
  params: ParamGroupSchema,
  methods: Schema.optionalKey(Schema.Record(Schema.String, MethodSchema)),
};

const LeafRack = Schema.Struct({
  ...BaseBlockFields,
  type: Schema.Literal("leaf"),
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
export type ParamValue = Schema.Schema.Type<typeof ParamValueSchema>;
export type ParamOption = Schema.Schema.Type<typeof ParamOptionSchema>;
export type RampMethod = Schema.Schema.Type<typeof RampMethodSchema>;
export type ParamAutomation = Schema.Schema.Type<typeof ParamAutomationSchema>;
export type MethodArg = Schema.Schema.Type<typeof MethodArgSchema>;
export type Method = Schema.Schema.Type<typeof MethodSchema>;
export type Patch = Schema.Schema.Type<typeof PatchSchema>;
export type Code = Schema.Schema.Type<typeof CodeSchema>;

export type TreeBlock = Schema.Schema.Type<typeof TreeRack>;

export const rootRack: TreeBlock = TreeRack.make({
  id: "root",
  name: "Root",
  type: "tree",
  isRoot: true,
  jackIds: [],
  params: {},
  children: [],
  patches: [],
});

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

export const hasOutputJack = (
  block: Rack,
  jacks: Record<string, Jack>,
): boolean =>
  block.isRoot || block.jackIds.some((id) => jacks[id]?.direction === "out");

export const canPatch = (root: TreeBlock, from: Jack, to: Jack): boolean =>
  from.direction === "out" &&
  to.direction === "in" &&
  from.belongToBlockId !== to.belongToBlockId &&
  root.children.includes(from.belongToBlockId) &&
  root.children.includes(to.belongToBlockId);

export const makeBlock = (
  id: string,
  parentId: string,
  blockType: "leaf" | "tree",
): Rack => {
  const shared = {
    id,
    isRoot: false,
    parentId,
    jackIds: makeDefaultJacks(id).map((jack) => jack.id),
    params: {},
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
        name: "Leaf",
        type: "leaf",
        // A new leaf runs nothing until the editor gives it code. `make`
        // checks this really is an Effect, so a null placeholder would throw.
        code: Effect.void,
      });
};
