import { Type, type Static } from "@earendil-works/pi-ai";
import {
  patternNames,
  type EventSettings,
  type ParamValue,
  type RackEventStep,
} from "../../rack";
import { oneOf, ToolProblem } from "./tool";

// An event's settings laid flat, so one shape serves every kind: what every
// kind shares, then what each kind reads. See settingsFrom.

const ParamValue = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const StepValue = Type.Union([Type.String(), Type.Number()]);

export const eventKinds = ["sequence", "event", "pattern", "part"] as const;

export const eventFields = {
  kind: oneOf(eventKinds, {
    description:
      "sequence: steps on a fixed subdivision, null for a rest. event: one trigger at start, looping every loopEnd when loop is true. pattern: values played in a pattern order every interval. part: steps at bars:beats:sixteenths times, looping every loopEnd when given. A step is the note; on a method with no note argument each step is just a hit. A loop (event) has no steps, so give its note as value.",
  }),
  args: Type.Optional(
    Type.Record(Type.String(), ParamValue, {
      description:
        'Fixed arguments for the method by name, such as {"duration": "8n"}. The time argument is filled in when the event fires, and the note argument comes from the step.',
    }),
  ),
  mute: Type.Optional(Type.Boolean()),
  probability: Type.Optional(
    Type.Number({ description: "Chance each hit plays, 0 to 1." }),
  ),
  humanize: Type.Optional(
    Type.Union([Type.Boolean(), Type.String()], {
      description: "true, or a time to shift each hit by at random.",
    }),
  ),
  playbackRate: Type.Optional(Type.Number()),
  steps: Type.Optional(
    Type.Array(
      Type.Union([
        StepValue,
        Type.Null(),
        Type.Object({
          time: Type.String(),
          value: Type.Union([StepValue, Type.Null()]),
        }),
      ]),
      {
        description:
          "sequence: notes or numbers with null for a rest. part: {time, value} pairs.",
      },
    ),
  ),
  subdivision: Type.Optional(
    Type.String({ description: "sequence: the step length, such as 8n." }),
  ),
  value: Type.Optional(StepValue),
  start: Type.Optional(
    Type.String({ description: "event: when it first fires, default 0." }),
  ),
  loop: Type.Optional(
    Type.Union([Type.Boolean(), Type.Number()], {
      description: "event: true, false or a number of times; default true.",
    }),
  ),
  loopEnd: Type.Optional(
    Type.String({ description: "event, part: how often it comes round." }),
  ),
  values: Type.Optional(
    Type.Array(StepValue, {
      description: "pattern: the values it draws from.",
    }),
  ),
  pattern: Type.Optional(
    oneOf(patternNames, { description: "pattern: the order; default up." }),
  ),
  interval: Type.Optional(
    Type.String({ description: "pattern: time between values, default 8n." }),
  ),
};

export const EventFields = Type.Object(eventFields);
export type EventFieldsInput = Static<typeof EventFields>;

const isPartStep = (step: unknown): step is RackEventStep =>
  typeof step === "object" && step !== null && "time" in step;

// Folds the flat fields into the settings of the kind they name.
export const settingsFrom = (
  input: EventFieldsInput,
  held?: EventSettings,
): EventSettings => {
  const kind = input.kind;
  const shared = {
    args: (input.args ?? held?.args ?? {}) as Record<string, ParamValue>,
    mute: input.mute ?? held?.mute ?? false,
    ...optional("probability", input.probability ?? held?.probability),
    ...optional("humanize", input.humanize ?? held?.humanize),
    ...optional("playbackRate", input.playbackRate ?? held?.playbackRate),
  };
  const was = held?.kind === kind ? held : undefined;
  switch (kind) {
    case "sequence": {
      const steps =
        input.steps ?? (was?.kind === "sequence" ? was.steps : undefined);
      if (steps === undefined) throw new ToolProblem("A sequence needs steps.");
      if (steps.some(isPartStep)) {
        throw new ToolProblem(
          "A sequence's steps are notes, numbers or null; {time, value} steps are for a part.",
        );
      }
      return {
        ...shared,
        kind,
        steps: steps as (string | number | null)[],
        subdivision:
          input.subdivision ??
          (was?.kind === "sequence" ? was.subdivision : "8n"),
      };
    }
    case "part": {
      const steps =
        input.steps ?? (was?.kind === "part" ? was.steps : undefined);
      if (steps === undefined) throw new ToolProblem("A part needs steps.");
      if (!steps.every(isPartStep)) {
        throw new ToolProblem("A part's steps are {time, value} pairs.");
      }
      return {
        ...shared,
        kind,
        steps,
        ...optional(
          "loopEnd",
          input.loopEnd ?? (was?.kind === "part" ? was.loopEnd : undefined),
        ),
      };
    }
    case "pattern": {
      const values =
        input.values ?? (was?.kind === "pattern" ? was.values : undefined);
      if (values === undefined)
        throw new ToolProblem("A pattern needs values.");
      return {
        ...shared,
        kind,
        values,
        pattern:
          input.pattern ?? (was?.kind === "pattern" ? was.pattern : "up"),
        interval:
          input.interval ?? (was?.kind === "pattern" ? was.interval : "8n"),
      };
    }
    case "event":
      return {
        ...shared,
        kind,
        ...optional(
          "value",
          input.value ?? (was?.kind === "event" ? was.value : undefined),
        ),
        start: input.start ?? (was?.kind === "event" ? was.start : "0"),
        loop: input.loop ?? (was?.kind === "event" ? was.loop : true),
        ...optional(
          "loopEnd",
          input.loopEnd ?? (was?.kind === "event" ? was.loopEnd : undefined),
        ),
      };
  }
};

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
