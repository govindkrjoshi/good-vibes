import type {
  Rack,
  Param,
  Method,
  MethodTemplate,
  RackEvent,
  Jack,
  ParamGroup,
} from "../rack/model.ts";

export type CatalogueItem = {
  name: string;
  category: string;
  rack: Rack;
  paramGroup: ParamGroup;
  methods: Record<string, Method>;
  events: Record<string, RackEvent>;
  jacks: Record<string, Jack>;
};

export type Catalogue = Readonly<
  Record<string, Readonly<Record<string, CatalogueItem>>>
>;

export const byId = <T extends { readonly id: string }>(
  items: readonly T[],
): Record<string, T> => Object.fromEntries(items.map((i) => [i.id, i]));

type NumberParam = Extract<Param, { kind: "number" }>;
type SelectParam = Extract<Param, { kind: "select" }>;
type Overrides<P> = Partial<Omit<P, "id" | "belongToRackId" | "kind">>;
type Defaults<P> = Omit<P, "id" | "belongToRackId">;

const automatable: NumberParam["automation"] = {
  methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
};

// The id comes from the final path, so a param moved into a group by an
// override (e.g. `path: ["oscillator", "detune"]`) still gets a unique id.
const makeParam = <P extends Param>(
  belongToRackId: string,
  defaults: Defaults<P>,
  overrides: Overrides<P>,
): P => {
  const merged = { ...defaults, ...overrides };
  return {
    ...merged,
    id: `${belongToRackId}:param:${merged.path.join(".")}`,
    belongToRackId,
  } as P;
};

const numberParam =
  (defaults: Defaults<NumberParam>) =>
  (belongToRackId: string, overrides: Overrides<NumberParam> = {}): Param =>
    makeParam<NumberParam>(belongToRackId, defaults, overrides);

const selectParam =
  (defaults: Defaults<SelectParam>) =>
  (belongToRackId: string, overrides: Overrides<SelectParam> = {}): Param =>
    makeParam<SelectParam>(belongToRackId, defaults, overrides);

export const volume = numberParam({
  name: "Volume",
  kind: "number",
  path: ["volume"],
  defaultValue: 0,
  min: -60,
  max: 12,
  step: 1,
  unit: "dB",
  automation: automatable,
});

export const detune = numberParam({
  name: "Detune",
  kind: "number",
  path: ["detune"],
  defaultValue: 0,
  min: -1200,
  max: 1200,
  step: 1,
  unit: "cents",
  automation: automatable,
});

export const portamento = numberParam({
  name: "Portamento",
  kind: "number",
  path: ["portamento"],
  defaultValue: 0,
  min: 0,
  step: 0.01,
  unit: "s",
});

export const harmonicity = numberParam({
  name: "Harmonicity",
  kind: "number",
  path: ["harmonicity"],
  defaultValue: 3,
  min: 0,
  max: 16,
  step: 0.01,
  automation: automatable,
});

export const oscillatorType = selectParam({
  name: "Type",
  kind: "select",
  path: ["type"],
  defaultValue: "sine",
  options: [
    { value: "sine" },
    { value: "square" },
    { value: "triangle" },
    { value: "sawtooth" },
  ],
});

export const pulseWidth = numberParam({
  name: "Pulse Width",
  kind: "number",
  path: ["width"],
  defaultValue: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const modulationFrequency = numberParam({
  name: "PWM Frequency",
  kind: "number",
  path: ["modulationFrequency"],
  defaultValue: 0.4,
  min: 0,
  step: 0.01,
  unit: "Hz",
  automation: automatable,
});

export const attack = numberParam({
  name: "Attack",
  kind: "number",
  path: ["attack"],
  defaultValue: 0.01,
  min: 0,
  step: 0.01,
  unit: "s",
});

export const decay = numberParam({
  name: "Decay",
  kind: "number",
  path: ["decay"],
  defaultValue: 0.1,
  min: 0,
  step: 0.01,
  unit: "s",
});

export const sustain = numberParam({
  name: "Sustain",
  kind: "number",
  path: ["sustain"],
  defaultValue: 1,
  min: 0,
  max: 1,
  step: 0.01,
});

export const release = numberParam({
  name: "Release",
  kind: "number",
  path: ["release"],
  defaultValue: 0.5,
  min: 0,
  step: 0.01,
  unit: "s",
});

type MethodOverrides = Partial<Omit<MethodTemplate, "method">>;

// The id comes from the Tone.js method name, which a block has only one of.
const method =
  (defaults: MethodTemplate) =>
  (belongToBlockId: string, overrides: MethodOverrides = {}): Method => ({
    ...defaults,
    ...overrides,
    id: `${belongToBlockId}:method:${defaults.method}`,
    belongToBlockId,
  });

export const triggerAttack = method({
  name: "Trigger Attack",
  method: "triggerAttack",
  args: [
    { name: "note", kind: "note" },
    { name: "time", kind: "time", optional: true },
    { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
  ],
});

export const triggerRelease = method({
  name: "Trigger Release",
  method: "triggerRelease",
  args: [{ name: "time", kind: "time", optional: true }],
});

export const triggerAttackRelease = method({
  name: "Trigger Attack Release",
  method: "triggerAttackRelease",
  args: [
    { name: "note", kind: "note" },
    { name: "duration", kind: "time" },
    { name: "time", kind: "time", optional: true },
    { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
  ],
});

export const setNote = method({
  name: "Set Note",
  method: "setNote",
  args: [
    { name: "note", kind: "note" },
    { name: "time", kind: "time", optional: true },
  ],
});

type SequenceEvent = Extract<RackEvent, { kind: "sequence" }>;
type EventOverrides<E> = Partial<
  Omit<E, "id" | "belongToBlockId" | "methodId" | "kind">
>;

// An event has no natural key of its own, so it is named by the caller.
export const sequence = (
  belongToBlockId: string,
  name: string,
  methodId: string,
  overrides: EventOverrides<SequenceEvent> = {},
): RackEvent => ({
  kind: "sequence",
  steps: [],
  subdivision: "8n",
  args: {},
  mute: false,
  ...overrides,
  id: `${belongToBlockId}:event:${name}`,
  belongToBlockId,
  methodId,
});

type JackOverrides = Partial<
  Omit<Jack, "id" | "belongToBlockId" | "direction">
>;

export const inputJack = (
  rackId: string,
  overrides: JackOverrides = {},
): Jack => ({
  name: "Input",
  ...overrides,
  id: `${rackId}:in`,
  belongToBlockId: rackId,
  direction: "in",
});

export const outputJack = (
  rackId: string,
  overrides: JackOverrides = {},
): Jack => ({
  name: "Output",
  ...overrides,
  id: `${rackId}:out`,
  belongToBlockId: rackId,
  direction: "out",
});
