import { Type } from "@earendil-works/pi-ai";

// The changes the agent can ask for, as the model sees them. This is the
// source of truth: RackAction in ./types is derived from it, and the tool
// takes a list of these. Only plain data, so whoever applies them can be
// anything.
//
// Block ids are the model's to choose, so one list can add a block and then
// patch it or set its params: a block's jacks and params hang off its id in
// a fixed way.
const describe = Type.Object(
  { kind: Type.Literal("describe") },
  {
    description:
      "Describes the rack as it is now: every block with its id, jacks, params and their current values, every patch, and the transport. Also lists the catalogue entries a block can be added from, with their param names. The other actions take their ids from this.",
  },
);

const addBlock = Type.Object(
  {
    kind: Type.Literal("add_block"),
    id: Type.String({
      minLength: 1,
      description:
        "An id of your choosing for the new block, short and unique, such as synth-1. Later actions, in this list or after, refer to the block by it. Its params are <id>:param:<param name>.",
    }),
    category: Type.String({ description: "The catalogue category" }),
    entry: Type.String({ description: "The entry within the category" }),
  },
  { description: "Adds a block from the catalogue to the rack." },
);

const removeBlocks = Type.Object(
  {
    kind: Type.Literal("remove_blocks"),
    blockIds: Type.Array(Type.String(), { minItems: 1 }),
  },
  {
    description:
      "Removes blocks from the rack, along with any patches into or out of them.",
  },
);

const connectBlocks = Type.Object(
  {
    kind: Type.Literal("connect_blocks"),
    fromBlockId: Type.String({ description: "The block sending sound" }),
    toBlockId: Type.String({ description: "The block receiving it" }),
  },
  {
    description:
      "Patches one block's output into another block's input. Sound only reaches the speakers through a Destination block.",
  },
);

const disconnect = Type.Object(
  { kind: Type.Literal("disconnect"), patchId: Type.String() },
  { description: "Removes a patch between two blocks." },
);

const setParam = Type.Object(
  {
    kind: Type.Literal("set_param"),
    paramId: Type.String(),
    value: Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
  },
  {
    description:
      "Sets a block's param. Numbers are clamped into the param's range; a select takes one of its options.",
  },
);

const setTransport = Type.Object(
  {
    kind: Type.Literal("set_transport"),
    bpm: Type.Number({ exclusiveMinimum: 0 }),
  },
  { description: "Sets the transport's tempo in beats per minute." },
);

const checkErrors = Type.Object(
  { kind: Type.Literal("check_errors") },
  {
    description:
      "Waits for the audio engine to finish carrying out every change so far, then lists what failed: blocks whose code did not build, patches that could not be made, params that could not be set, events that could not be scheduled or failed while playing. Use it after changing blocks, patches or events, and before saying you are done. It cannot promise an event will not fail later, while playing.",
  },
);

const retry = Type.Object(
  {
    kind: Type.Literal("retry"),
    entity: Type.Union([
      Type.Literal("block"),
      Type.Literal("patch"),
      Type.Literal("event"),
    ]),
    id: Type.String(),
  },
  {
    description:
      "Builds a block, patch or event again as it is, for a failure that might not happen twice. A failure that will happen again needs a change instead. Check errors afterwards to see how it went.",
  },
);

export const RackActionSchema = Type.Union([
  describe,
  addBlock,
  removeBlocks,
  connectBlocks,
  disconnect,
  setParam,
  setTransport,
  checkErrors,
  retry,
]);
