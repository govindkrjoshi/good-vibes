import type { ParamSpec } from "../spec";

type NumberParam = Extract<ParamSpec, { kind: "number" }>;
type SelectParam = Extract<ParamSpec, { kind: "select" }>;
type BooleanParam = Extract<ParamSpec, { kind: "boolean" }>;
type Overrides<P> = Partial<Omit<P, "kind">>;

// Each factory takes a param's defaults and gives a function that makes it,
// with any of its fields overridden. An item declares a one-off param inline
// with these; a param two items share belongs below.
export const numberParam =
  (defaults: Omit<NumberParam, "kind">) =>
  (overrides: Overrides<NumberParam> = {}): ParamSpec => ({
    kind: "number",
    ...defaults,
    ...overrides,
  });

export const selectParam =
  (defaults: Omit<SelectParam, "kind">) =>
  (overrides: Overrides<SelectParam> = {}): ParamSpec => ({
    kind: "select",
    ...defaults,
    ...overrides,
  });

export const booleanParam =
  (defaults: Omit<BooleanParam, "kind">) =>
  (overrides: Overrides<BooleanParam> = {}): ParamSpec => ({
    kind: "boolean",
    ...defaults,
    ...overrides,
  });

export const automatable: NumberParam["automation"] = {
  methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
};

// Lists of values as select options.
export const options = (values: readonly (string | number)[]) =>
  values.map((value) => ({ value }));

export const volume = numberParam({
  name: "Volume",
  path: ["volume"],
  defaultValue: 0,
  min: -60,
  max: 12,
  step: 1,
  unit: "dB",
  automation: automatable,
});

export const mute = booleanParam({
  name: "Mute",
  path: ["mute"],
  defaultValue: false,
});

export const detune = numberParam({
  name: "Detune",
  path: ["detune"],
  defaultValue: 0,
  min: -1200,
  max: 1200,
  step: 1,
  unit: "cents",
  automation: automatable,
});

export const frequency = numberParam({
  name: "Frequency",
  path: ["frequency"],
  defaultValue: 440,
  min: 20,
  max: 20000,
  step: 1,
  unit: "Hz",
  automation: automatable,
});

export const phase = numberParam({
  name: "Phase",
  path: ["phase"],
  defaultValue: 0,
  min: 0,
  max: 360,
  step: 1,
  unit: "deg",
});

export const portamento = numberParam({
  name: "Portamento",
  path: ["portamento"],
  defaultValue: 0,
  min: 0,
  step: 0.01,
  unit: "s",
});

export const harmonicity = numberParam({
  name: "Harmonicity",
  path: ["harmonicity"],
  defaultValue: 3,
  min: 0,
  max: 16,
  step: 0.01,
  automation: automatable,
});

export const modulationIndex = numberParam({
  name: "Modulation Index",
  path: ["modulationIndex"],
  defaultValue: 10,
  min: 0,
  max: 100,
  step: 0.1,
  automation: automatable,
});

export const basicTypes = ["sine", "square", "triangle", "sawtooth"] as const;

export const oscillatorType = selectParam({
  name: "Type",
  path: ["type"],
  defaultValue: "sine",
  options: options(basicTypes),
});

export const pulseWidth = numberParam({
  name: "Pulse Width",
  path: ["width"],
  defaultValue: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const modulationFrequency = numberParam({
  name: "PWM Frequency",
  path: ["modulationFrequency"],
  defaultValue: 0.4,
  min: 0,
  step: 0.01,
  unit: "Hz",
  automation: automatable,
});

export const attack = numberParam({
  name: "Attack",
  path: ["attack"],
  defaultValue: 0.01,
  min: 0,
  step: 0.01,
  unit: "s",
});

export const decay = numberParam({
  name: "Decay",
  path: ["decay"],
  defaultValue: 0.1,
  min: 0,
  step: 0.01,
  unit: "s",
});

export const sustain = numberParam({
  name: "Sustain",
  path: ["sustain"],
  defaultValue: 1,
  min: 0,
  max: 1,
  step: 0.01,
});

export const release = numberParam({
  name: "Release",
  path: ["release"],
  defaultValue: 0.5,
  min: 0,
  step: 0.01,
  unit: "s",
});

// The mix of an effect's processed signal with what came in.
export const wet = numberParam({
  name: "Wet",
  path: ["wet"],
  defaultValue: 1,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const q = numberParam({
  name: "Q",
  path: ["Q"],
  defaultValue: 1,
  min: 0,
  max: 30,
  step: 0.1,
  automation: automatable,
});

export const gain = numberParam({
  name: "Gain",
  path: ["gain"],
  defaultValue: 0,
  min: -40,
  max: 40,
  step: 0.5,
  unit: "dB",
  automation: automatable,
});

export const filterTypes = [
  "lowpass",
  "highpass",
  "bandpass",
  "lowshelf",
  "highshelf",
  "notch",
  "allpass",
  "peaking",
] as const;

export const filterType = selectParam({
  name: "Type",
  path: ["type"],
  defaultValue: "lowpass",
  options: options(filterTypes),
});

export const rolloff = selectParam({
  name: "Rolloff",
  path: ["rolloff"],
  defaultValue: -12,
  options: options([-12, -24, -48, -96]),
});

export const threshold = numberParam({
  name: "Threshold",
  path: ["threshold"],
  defaultValue: -24,
  min: -100,
  max: 0,
  step: 1,
  unit: "dB",
  automation: automatable,
});

export const ratio = numberParam({
  name: "Ratio",
  path: ["ratio"],
  defaultValue: 12,
  min: 1,
  max: 20,
  step: 0.1,
  automation: automatable,
});

export const knee = numberParam({
  name: "Knee",
  path: ["knee"],
  defaultValue: 30,
  min: 0,
  max: 40,
  step: 1,
  unit: "dB",
  automation: automatable,
});

export const delayTime = numberParam({
  name: "Delay Time",
  path: ["delayTime"],
  defaultValue: 0.25,
  min: 0,
  max: 1,
  step: 0.01,
  unit: "s",
  automation: automatable,
});

export const feedback = numberParam({
  name: "Feedback",
  path: ["feedback"],
  defaultValue: 0.125,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const depth = numberParam({
  name: "Depth",
  path: ["depth"],
  defaultValue: 1,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const pan = numberParam({
  name: "Pan",
  path: ["pan"],
  defaultValue: 0,
  min: -1,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const octaves = numberParam({
  name: "Octaves",
  path: ["octaves"],
  defaultValue: 1,
  min: 0,
  max: 8,
  step: 0.1,
});

export const resonance = numberParam({
  name: "Resonance",
  path: ["resonance"],
  defaultValue: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

export const smoothing = numberParam({
  name: "Smoothing",
  path: ["smoothing"],
  defaultValue: 0.8,
  min: 0,
  max: 1,
  step: 0.01,
});

export const normalRange = booleanParam({
  name: "Normal Range",
  path: ["normalRange"],
  defaultValue: false,
});
