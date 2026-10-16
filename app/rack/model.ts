import { Context, Data, Schema } from "effect";
import type { Effect } from "effect";
import type * as ToneJs from "tone";

type ToneNode = ToneJs.ToneAudioNode;

// The Tone.js module, handed to leaf code as a service. The browser provides
// the real module; tests provide the same module running on a node audio
// context.
export class Tone extends Context.Service<Tone, typeof ToneJs>()("Tone") {}

// Why the renderer could not do something, as a code the app can act on.
// Leaf code may fail with a LeafError of its own, which has no code.
export type RenderErrorCode =
  // The leaf's code did not parse, threw, or failed.
  | "LeafThrew"
  // The leaf's code ran but built something other than a Tone.js node.
  | "LeafNotANode"
  // A param could not be set on the node.
  | "ParamRejected"
  // The block this needs did not build.
  | "BlockFailed"
  // A patch end did not build, so there is nothing to connect.
  | "EndpointFailed"
  // Both ends built, and Tone.js would not connect them.
  | "PatchFailed"
  // Tone.js would not schedule an event with its settings.
  | "ScheduleFailed"
  // A method call on the node threw.
  | "MethodThrew"
  // What the command names is not in the rack.
  | "Missing";

export class LeafError extends Data.TaggedError("LeafError")<{
  readonly message: string;
  readonly code?: RenderErrorCode;
}> {}

// What a leaf block runs to make its Tone.js node: the source of a JavaScript
// expression that evaluates to an Effect needing Tone, such as
//
//   Effect.gen(function* () {
//     const tone = yield* Tone;
//     return new tone.AMSynth();
//   })
//
// It is kept as source rather than a function so the rack can be handed to the
// sandbox frame, which is the only place it is ever evaluated. There `Effect`,
// `Tone` and `LeafError` are in scope. Param values are applied by the renderer
// afterwards, so the code only has to construct the node.
export type LeafCode = string;
export type LeafEffect = Effect.Effect<ToneNode, LeafError, Tone>;

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

const CodeSchema = Schema.String.annotate({
  title: "Code",
  description:
    "Source of an expression evaluating to the Effect that builds a leaf's Tone.js node",
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
const AutomationEventSchema = Schema.Struct({
  id: Schema.String,
  method: RampMethodSchema,
  value: Schema.Number,
  time: Schema.String,
  rampTime: Schema.optionalKey(Schema.String),
});

export type AutomationEvent = Schema.Schema.Type<typeof AutomationEventSchema>;

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
  paramIds: {},
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
        code: 'Effect.fail(new LeafError({ message: "Leaf has no code" }))',
      });
};

// Everything the rack holds, keyed by id. The store keeps one of these and
// the renderer reads it to build the audio graph. It is plain data, so it can
// be cloned into the sandbox frame, which checks it against this schema.
export const RackStateSchema = Schema.Struct({
  blocks: Schema.Record(Schema.String, RackSchema),
  jacks: Schema.Record(Schema.String, JackSchema),
  params: Schema.Record(Schema.String, ParamSchema),
  methods: Schema.Record(Schema.String, MethodSchema),
  values: Schema.Record(Schema.String, ParamValueSchema),
  automations: Schema.Record(
    Schema.String,
    Schema.Array(AutomationEventSchema),
  ),
  patches: Schema.Record(Schema.String, PatchSchema),
  events: Schema.Record(Schema.String, RackEventSchema),
  transport: TransportSchema,
  rootId: Schema.String,
});

export type RackState = Schema.Schema.Type<typeof RackStateSchema>;

export const rackStateKeys = Object.keys(
  RackStateSchema.fields,
) as readonly (keyof RackState)[];
