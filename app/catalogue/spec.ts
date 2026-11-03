import { Schema } from "effect";

import {
  BooleanParamFields,
  EventSettingFields,
  JackPortSchema,
  MethodArgSchema,
  NumberParamFields,
  PartEventFields,
  PatternEventFields,
  ReadoutSchema,
  SelectParamFields,
  SequenceEventFields,
  TextParamFields,
  ToneEventFields,
} from "../rack/model";

// A catalogue item is plain data with no ids, so a plugin can be written by
// hand, saved as JSON, or made by the agent, and read back the same way. It
// gets ids when it is placed; see instantiate.ts.

export const categories = [
  "sources",
  "instruments",
  "effects",
  "components",
  "signals",
  "outputs",
] as const;

const CategorySchema = Schema.Literals(categories);

// A param as a rack has it, less the ids. A patchable one gets a jack that
// a signal can drive it through.
const ParamSpecFields = {
  name: Schema.String,
  path: Schema.Array(Schema.String),
  order: Schema.optionalKey(Schema.Number),
  description: Schema.optionalKey(Schema.String),
  patchable: Schema.optionalKey(Schema.Boolean),
};

const ParamSpecSchema = Schema.Union([
  Schema.Struct({ ...ParamSpecFields, ...NumberParamFields }),
  Schema.Struct({ ...ParamSpecFields, ...BooleanParamFields }),
  Schema.Struct({ ...ParamSpecFields, ...TextParamFields }),
  Schema.Struct({ ...ParamSpecFields, ...SelectParamFields }),
]);

export type ParamSpec = Schema.Schema.Type<typeof ParamSpecSchema>;

export interface ParamSpecGroup {
  readonly name?: string;
  readonly params?: readonly ParamSpec[];
  readonly groups?: Readonly<Record<string, ParamSpecGroup>>;
}

const ParamSpecGroupSchema: Schema.Codec<ParamSpecGroup> = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Array(ParamSpecSchema)),
  groups: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<ParamSpecGroup> => ParamSpecGroupSchema),
    ),
  ),
});

const MethodSpecSchema = Schema.Struct({
  name: Schema.String,
  method: Schema.String,
  description: Schema.optionalKey(Schema.String),
  args: Schema.Array(MethodArgSchema),
});

export type MethodSpec = Schema.Schema.Type<typeof MethodSpecSchema>;

// An event names the Tone.js method it calls, which is one of the item's.
const EventSpecFields = { ...EventSettingFields, method: Schema.String };

const EventSpecSchema = Schema.Union([
  Schema.Struct({ ...EventSpecFields, ...SequenceEventFields }),
  Schema.Struct({ ...EventSpecFields, ...ToneEventFields }),
  Schema.Struct({ ...EventSpecFields, ...PatternEventFields }),
  Schema.Struct({ ...EventSpecFields, ...PartEventFields }),
]);

export type EventSpec = Schema.Schema.Type<typeof EventSpecSchema>;

// A jack needs a key when it shares its direction with another jack.
const JackSpecSchema = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  direction: Schema.Literals(["in", "out"]),
  port: Schema.optionalKey(JackPortSchema),
});

export type JackSpec = Schema.Schema.Type<typeof JackSpecSchema>;

// `code` is the source of the Effect that builds the item's node, as a leaf
// rack has it. It only ever runs in the sandbox.
const LeafSpecSchema = Schema.Struct({
  type: Schema.Literal("leaf"),
  name: Schema.String,
  category: CategorySchema,
  description: Schema.String,
  code: Schema.String,
  params: Schema.optionalKey(ParamSpecGroupSchema),
  methods: Schema.optionalKey(Schema.Array(MethodSpecSchema)),
  events: Schema.optionalKey(Schema.Array(EventSpecSchema)),
  // An item that leaves them out gets an input and an output.
  jacks: Schema.optionalKey(Schema.Array(JackSpecSchema)),
  readout: Schema.optionalKey(ReadoutSchema),
});

// A union so a tree item can join later without changing the format.
export const ItemSpecSchema = Schema.Union([LeafSpecSchema]);

export type ItemSpec = Schema.Schema.Type<typeof ItemSpecSchema>;
export type Category = ItemSpec["category"];

// What a plugin says about itself. Its items are decoded one at a time, so
// one bad item doesn't keep the rest out.
export const PluginHeaderSchema = Schema.Struct({
  format: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  items: Schema.Array(Schema.Unknown),
});

export type PluginSpec = Omit<
  Schema.Schema.Type<typeof PluginHeaderSchema>,
  "items"
> & {
  readonly items: readonly ItemSpec[];
};

export const decodeItem = Schema.decodeUnknownSync(ItemSpecSchema);
export const decodePluginHeader = Schema.decodeUnknownSync(PluginHeaderSchema);
export const encodeItem = Schema.encodeSync(ItemSpecSchema);
