import { Context, Data, Effect, Schema } from "effect";
import type * as ToneJs from "tone";
import { inputJack, outputJack } from "../catalogue/common";

type ToneNode = ToneJs.ToneAudioNode;

// What leaf code renders with, handed to it as a service. `tone` is the
// Tone.js module: the browser provides the real module; tests provide the
// same module running on a node audio context.
export class RenderContext extends Context.Service<
  RenderContext,
  { readonly tone: typeof ToneJs }
>()("RenderContext") {}

export class LeafError extends Data.TaggedError("LeafError")<{
  readonly message: string;
}> {}

// What a leaf block runs to make its Tone.js node. Param values are applied
// by the renderer afterwards, so the code only has to construct the node.
export type LeafCode = Effect.Effect<ToneNode, LeafError, RenderContext>;

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
  belongToRackId: Schema.String,
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
  readonly id: string;
  readonly name?: string;
  readonly params?: readonly Param[];
  readonly groups?: Readonly<Record<string, ParamGroup>>;
}

const ParamGroupSchema: Schema.Codec<ParamGroup> = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Array(ParamSchema)),
  groups: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<ParamGroup> => ParamGroupSchema),
    ),
  ),
});

const CodeSchema = Schema.declare(
  (input): input is LeafCode => Effect.isEffect(input),
  {
    title: "Code",
    description: "The Effect that builds a leaf's Tone.js node",
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
  paramGroupId: Schema.optionalKey(Schema.String),
  methodIds: Schema.Array(Schema.String),
  eventIds: Schema.Array(Schema.String),
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

const StepValueSchema = Schema.Union([Schema.String, Schema.Number]);

const PatternNameSchema = Schema.Literals([
  "up",
  "down",
  "upDown",
  "downUp",
  "alternateUp",
  "alternateDown",
  "random",
  "randomOnce",
  "randomWalk",
]);

// What every Tone event class shares: the method it calls with its fixed
// args, and the ToneEvent knobs.
const BaseEventFields = {
  id: Schema.String,
  belongToBlockId: Schema.String,
  methodId: Schema.String,
  args: Schema.Record(Schema.String, ParamValueSchema),
  mute: Schema.Boolean,
  probability: Schema.optionalKey(Schema.Number),
  humanize: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.String])),
  playbackRate: Schema.optionalKey(Schema.Number),
};

// A null step is a rest.
const SequenceEventSchema = Schema.Struct({
  ...BaseEventFields,
  kind: Schema.Literal("sequence"),
  steps: Schema.Array(Schema.NullOr(StepValueSchema)),
  subdivision: Schema.String,
});

// Tone's Loop is a ToneEvent with loop on and loopEnd as its interval, so a
// loop is this kind with no value.
const ToneEventSchema = Schema.Struct({
  ...BaseEventFields,
  kind: Schema.Literal("event"),
  value: Schema.optionalKey(StepValueSchema),
  start: Schema.String,
  loop: Schema.Union([Schema.Boolean, Schema.Number]),
  loopEnd: Schema.optionalKey(Schema.String),
});

const PatternEventSchema = Schema.Struct({
  ...BaseEventFields,
  kind: Schema.Literal("pattern"),
  values: Schema.Array(StepValueSchema),
  pattern: PatternNameSchema,
  interval: Schema.String,
});

const EventStepSchema = Schema.Struct({
  time: Schema.String,
  value: Schema.NullOr(StepValueSchema),
});

// Plays once, or loops when it has a loopEnd.
const PartEventSchema = Schema.Struct({
  ...BaseEventFields,
  kind: Schema.Literal("part"),
  steps: Schema.Array(EventStepSchema),
  loopEnd: Schema.optionalKey(Schema.String),
});

const RackEventSchema = Schema.Union([
  SequenceEventSchema,
  ToneEventSchema,
  PatternEventSchema,
  PartEventSchema,
]);

export const isRackEvent = Schema.is(RackEventSchema);

const TransportSchema = Schema.Struct({ bpm: Schema.Number });

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
export type RackEvent = Schema.Schema.Type<typeof RackEventSchema>;
export type RackEventStep = Schema.Schema.Type<typeof EventStepSchema>;
export type Transport = Schema.Schema.Type<typeof TransportSchema>;

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

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export interface ParamTemplateGroup {
  readonly name?: string;
  readonly params?: Readonly<Record<string, ParamTemplate>>;
  readonly groups?: Readonly<Record<string, ParamTemplateGroup>>;
}

// The method is named separately when an event is added, and stays fixed.
export type EventSettings = DistributiveOmit<
  RackEvent,
  "id" | "belongToBlockId" | "methodId"
>;

export type ParamTemplate = DistributiveOmit<Param, "id" | "belongToBlockId">;
export type MethodTemplate = Omit<Method, "id" | "belongToBlockId">;
// `method` is the key of the method in the same template's `methods`.
export type EventTemplate = EventSettings & { readonly method: string };
export type RackTemplate = DistributiveOmit<
  Rack,
  "paramIds" | "methodIds" | "eventIds"
> & {
  readonly params: ParamTemplateGroup;
  readonly methods?: Readonly<Record<string, MethodTemplate>>;
  // What the block plays as soon as it is added.
  readonly events?: Readonly<Record<string, EventTemplate>>;
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
  methodIds: [],
  eventIds: [],
  children: [],
  patches: [],
});

// Where a scheduled event puts the time Tone fires it. A duration comes before
// the time it starts at, as in triggerAttackRelease, so it is the last one.
export const timeArg = (method: Method): MethodArg | undefined =>
  [...method.args].reverse().find((arg) => arg.kind === "time");

// Where a scheduled event puts its step value.
export const noteArg = (method: Method): MethodArg | undefined =>
  method.args.find((arg) => arg.kind === "note");

export const hasOutputJack = (
  block: Rack,
  jacks: Record<string, Jack>,
): boolean =>
  block.isRoot || block.jackIds.some((id) => jacks[id]?.direction === "out");

// The tree that holds a patch between two jacks, if they can be patched. Signal
// goes from a rack's output to a sibling's input. Seen from inside a tree its
// jacks flip: its inputs feed its children, and its children feed its outputs.
export const patchScope = (
  racks: Readonly<Record<string, Rack>>,
  from: Jack,
  to: Jack,
): string | undefined => {
  const fromRack = racks[from.belongToBlockId];
  const toRack = racks[to.belongToBlockId];
  if (fromRack === undefined || toRack === undefined || fromRack === toRack) {
    return undefined;
  }

  if (from.direction === "out" && to.direction === "in") {
    return fromRack.parentId === toRack.parentId
      ? fromRack.parentId
      : undefined;
  }
  if (from.direction === "in" && to.direction === "in") {
    return toRack.parentId === fromRack.id ? fromRack.id : undefined;
  }
  if (from.direction === "out" && to.direction === "out") {
    return fromRack.parentId === toRack.id ? toRack.id : undefined;
  }
  return undefined;
};

export const canPatch = (
  racks: Readonly<Record<string, Rack>>,
  from: Jack,
  to: Jack,
): boolean => patchScope(racks, from, to) !== undefined;

// Whether a rack sits somewhere under another rack, however deep.
export const isInside = (
  racks: Readonly<Record<string, Rack>>,
  rackId: string,
  ancestorId: string,
): boolean => {
  const parentId = racks[rackId]?.parentId;
  return (
    parentId !== undefined &&
    (parentId === ancestorId || isInside(racks, parentId, ancestorId))
  );
};

export const makeBlock = (
  id: string,
  parentId: string,
  blockType: "leaf" | "tree",
): Rack => {
  const shared = {
    id,
    isRoot: false,
    parentId,
    jackIds: [inputJack(id).id, outputJack(id).id],
    paramGroupId: "",
    methodIds: [],
    eventIds: [],
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
        code: Effect.fail(new LeafError({ message: "Leaf has no code" })),
      });
};

// Everything the rack holds, keyed by id. The store keeps one of these and
// the renderer reads it to build the audio graph.
export type RackState = {
  readonly racks: Record<string, Rack>;
  readonly jacks: Record<string, Jack>;
  readonly paramGroups: Record<string, ParamGroup>;
  readonly methods: Record<string, Method>;
  readonly values: Record<string, ParamValue>;
  readonly automations: Record<string, readonly AutomationEvent[]>;
  readonly patches: Record<string, Patch>;
  readonly events: Record<string, RackEvent>;
  readonly transport: Transport;
  readonly rootId: string;
};

// Every param in a group and its subgroups, in the order the group lists them.
export const flattenParams = (group: ParamGroup): Param[] => [
  ...(group.params ?? []),
  ...Object.values(group.groups ?? {}).flatMap(flattenParams),
];

// A rack's params, or none when it has no param group.
export const rackParams = (
  state: Pick<RackState, "racks" | "paramGroups">,
  rackId: string,
): Param[] => {
  const groupId = state.racks[rackId]?.paramGroupId;
  const group = groupId === undefined ? undefined : state.paramGroups[groupId];
  return group === undefined ? [] : flattenParams(group);
};

// The param with an id, looked up through every param group.
export const findParam = (
  state: Pick<RackState, "paramGroups">,
  paramId: string,
): Param | undefined =>
  Object.values(state.paramGroups)
    .flatMap(flattenParams)
    .find((param) => param.id === paramId);
