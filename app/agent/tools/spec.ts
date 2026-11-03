import { Type, type Static } from "@earendil-works/pi-ai";
import {
  categories,
  decodeItem,
  itemProblems,
  type ItemSpec,
} from "../../catalogue";
import { rampMethods } from "../../rack";
import { eventFields } from "./events";
import { oneOf, ToolProblem } from "./tool";

// A catalogue item as the model writes one: the same plain data a plugin
// holds, with the parts an item usually leaves out made optional. It is
// checked by the catalogue's own schema before it goes anywhere.

const ParamValue = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);

export const codeHelp = `The source of one JavaScript expression that evaluates to an Effect yielding a Tone.js node. It sees only Effect, RenderContext and LeafError, and runs in a sandbox. The usual form:
Effect.gen(function* () {
  const { tone } = yield* RenderContext;
  return new tone.AutoFilter().start();
})
Build the node only: params are set on it afterwards with node.set() along each param's path, so every param path must be something the node's set() accepts (its get() shows them). A source (oscillator, LFO, noise, player) has to be started. To fail on purpose: yield* Effect.fail(new LeafError({ message: "..." })).`;

const ParamSpec = Type.Object({
  name: Type.String(),
  path: Type.Array(Type.String(), {
    description:
      'Where node.set() puts the value, split at the dots: ["filter", "Q"] for filter.Q.',
  }),
  kind: oneOf(["number", "boolean", "text", "select"]),
  defaultValue: ParamValue,
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  step: Type.Optional(Type.Number()),
  unit: Type.Optional(Type.String()),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        value: ParamValue,
        label: Type.Optional(Type.String()),
      }),
      { description: "select only: the values it can take." },
    ),
  ),
  automation: Type.Optional(
    Type.Object(
      {
        methods: Type.Array(oneOf(rampMethods)),
      },
      {
        description:
          "number only: how the param can be scheduled, when the path leads to a Tone Param or Signal.",
      },
    ),
  ),
  patchable: Type.Optional(
    Type.Boolean({
      description:
        "number only: gives the param an input jack a signal can drive it through. The path must lead to a Tone Param or Signal.",
    }),
  ),
  description: Type.Optional(Type.String()),
  order: Type.Optional(Type.Number()),
});

const ParamGroup = Type.Object({
  name: Type.Optional(Type.String()),
  params: Type.Optional(Type.Array(ParamSpec)),
  groups: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({
        name: Type.Optional(Type.String()),
        params: Type.Optional(Type.Array(ParamSpec)),
      }),
      { description: "Named sections of params, shown apart on the panel." },
    ),
  ),
});

const JackSpec = Type.Object({
  direction: oneOf(["in", "out"]),
  key: Type.Optional(
    Type.String({
      description:
        "Needed when two jacks share a direction; becomes part of the jack's id.",
    }),
  ),
  name: Type.Optional(Type.String()),
  port: Type.Optional(
    Type.Object(
      {
        member: Type.Optional(Type.Array(Type.String())),
        index: Type.Optional(Type.Number()),
      },
      {
        description:
          'What the jack reaches: a member of the node such as ["a"] for a CrossFade\'s a, or a numbered input/output as on a Split. Leave out for the node itself.',
      },
    ),
  ),
});

const MethodArg = Type.Object({
  name: Type.String(),
  kind: oneOf(["boolean", "number", "text", "time", "note"]),
  optional: Type.Optional(Type.Boolean()),
  defaultValue: Type.Optional(ParamValue),
  description: Type.Optional(Type.String()),
});

const MethodSpec = Type.Object({
  name: Type.String(),
  method: Type.String({ description: "The method's name on the node." }),
  description: Type.Optional(Type.String()),
  args: Type.Array(MethodArg, {
    description:
      "In the node's order. An event needs one time arg (the last one is used); a note arg takes the step value.",
  }),
});

const EventSpec = Type.Object({
  ...eventFields,
  method: Type.String({
    description: "One of the item's methods, by method name.",
  }),
});

export const ItemSpecInput = Type.Object({
  name: Type.String(),
  description: Type.String(),
  code: Type.String({ description: codeHelp }),
  category: Type.Optional(
    oneOf(categories, { description: "Default components." }),
  ),
  params: Type.Optional(ParamGroup),
  jacks: Type.Optional(
    Type.Array(JackSpec, {
      description: "Default one input and one output on the node itself.",
    }),
  ),
  methods: Type.Optional(Type.Array(MethodSpec)),
  events: Type.Optional(
    Type.Array(EventSpec, { description: "Events the rack arrives playing." }),
  ),
  readout: Type.Optional(
    Type.Object({
      kind: oneOf(["level", "dc", "spectrum", "waveform"]),
    }),
  ),
});

export type ItemSpecInputType = Static<typeof ItemSpecInput>;

const withoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, held]) => held !== undefined)
        .map(([key, held]) => [key, withoutUndefined(held)]),
    );
  }
  return value;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The model's spec as an item the catalogue would accept, or why not.
export const toItemSpec = (input: ItemSpecInputType): ItemSpec => {
  const raw = withoutUndefined({
    type: "leaf",
    category: "components",
    ...input,
    events: input.events?.map((event) => ({ args: {}, mute: false, ...event })),
  });
  let item: ItemSpec;
  try {
    item = decodeItem(raw);
  } catch (error) {
    throw new ToolProblem(
      `The spec doesn't hold together: ${messageOf(error)}`,
    );
  }
  const problems = itemProblems(item);
  if (problems.length > 0) throw new ToolProblem(problems);
  return item;
};
