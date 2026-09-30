import { Effect, Schema } from "effect";
import { LeafError, type LeafCode } from "../audio-renderer";

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
  id: Schema.String,
  name: Schema.String,
  belongToBlockId: Schema.String,
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
  readonly paramIds?: Readonly<Record<string, string>>;
  readonly groups?: Readonly<Record<string, ParamGroup>>;
}

const ParamGroupSchema: Schema.Codec<ParamGroup> = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  paramIds: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  groups: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<ParamGroup> => ParamGroupSchema),
    ),
  ),
});

const CodeSchema = Schema.declare(
  (input): input is LeafCode => typeof input === "function",
  {
    title: "Code",
    description:
      "A function returning the Effect that builds a leaf's Tone.js node",
  },
);

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
  id: Schema.String,
  name: Schema.String,
  belongToBlockId: Schema.String,
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
  paramIds: ParamGroupSchema,
  methodIds: Schema.Array(Schema.String),
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
export type LeafRack = Schema.Schema.Type<typeof LeafRack>;
export type TreeRack = Schema.Schema.Type<typeof TreeRack>;
export type Jack = Schema.Schema.Type<typeof JackSchema>;
export type ParamValue = Schema.Schema.Type<typeof ParamValueSchema>;
export type ParamOption = Schema.Schema.Type<typeof ParamOptionSchema>;
export type RampMethod = Schema.Schema.Type<typeof RampMethodSchema>;
export type ParamAutomation = Schema.Schema.Type<typeof ParamAutomationSchema>;
export type MethodArg = Schema.Schema.Type<typeof MethodArgSchema>;
export type Method = Schema.Schema.Type<typeof MethodSchema>;
export type Patch = Schema.Schema.Type<typeof PatchSchema>;
export type Code = Schema.Schema.Type<typeof CodeSchema>;

// One scheduled change to a number param, named after the Tone.js call that
// will make it. `time` is when it lands (or, for the two ramp-to-value calls,
// when the ramp ends); `rampTime` is only read by `rampTo`, which ramps over a
// duration starting at `time`.
export type AutomationEvent = {
  readonly id: string;
  readonly method: RampMethod;
  readonly value: number;
  readonly time: string;
  readonly rampTime?: string;
};

// A method the user has asked a block to run, waiting for the interpreter to
// pick it up.
export type MethodCall = {
  readonly id: string;
  readonly methodId: string;
  readonly args: Readonly<Record<string, ParamValue>>;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface ParamTemplateGroup {
  readonly name?: string;
  readonly params?: Readonly<Record<string, ParamTemplate>>;
  readonly groups?: Readonly<Record<string, ParamTemplateGroup>>;
}

export type ParamTemplate = DistributiveOmit<Param, "id" | "belongToBlockId">;
export type MethodTemplate = Omit<Method, "id" | "belongToBlockId">;
export type RackTemplate = DistributiveOmit<Rack, "paramIds" | "methodIds"> & {
  readonly params: ParamTemplateGroup;
  readonly methods?: Readonly<Record<string, MethodTemplate>>;
  // Which of the default jacks a block made from this template gets. Most get
  // both; a sink like the destination only takes input.
  readonly jacks?: readonly Jack["direction"][];
};

export type TreeBlock = Schema.Schema.Type<typeof TreeRack>;

export const rootRack: TreeBlock = TreeRack.make({
  id: "root",
  name: "Root",
  type: "tree",
  isRoot: true,
  jackIds: [],
  paramIds: {},
  methodIds: [],
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
    paramIds: {},
    methodIds: [],
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
        // A new leaf has no Tone.js node until the editor gives it code, so
        // rendering it fails rather than silently producing nothing.
        code: () => Effect.fail(new LeafError({ message: "Leaf has no code" })),
      });
};
