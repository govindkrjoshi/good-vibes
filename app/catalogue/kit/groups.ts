import type { ParamSpec, ParamSpecGroup } from "../spec";
import {
  attack,
  basicTypes,
  decay,
  detune,
  filterType,
  frequency,
  modulationFrequency,
  octaves,
  options,
  oscillatorType,
  pulseWidth,
  q,
  release,
  rolloff,
  sustain,
} from "./params";

type Stages = Partial<
  Record<"attack" | "decay" | "sustain" | "release", number>
>;

// The four stages under `path`, which the rack draws as one curve.
export const envelopeGroup = (
  path: readonly string[],
  { name = "Envelope", ...defaults }: Stages & { readonly name?: string } = {},
): ParamSpecGroup => {
  const at = (key: string) => ({ path: [...path, key] });
  const value = (stage: keyof Stages) =>
    defaults[stage] === undefined ? {} : { defaultValue: defaults[stage] };
  return {
    name,
    params: [
      attack({ ...at("attack"), ...value("attack") }),
      decay({ ...at("decay"), ...value("decay") }),
      sustain({ ...at("sustain"), ...value("sustain") }),
      release({ ...at("release"), ...value("release") }),
    ],
  };
};

// Every waveform an instrument's OmniOscillator can take.
export const omniTypes = [
  ...basicTypes,
  "pulse",
  "pwm",
  "fatsine",
  "fmsine",
  "amsine",
] as const;

// An instrument's oscillator: its waveform, its detune, and the knobs only
// some waveforms read (Tone ignores them for the rest).
export const oscillatorGroup = (
  path: readonly string[],
  {
    name = "Oscillator",
    type = "sine",
    types = omniTypes,
  }: {
    readonly name?: string;
    readonly type?: string;
    readonly types?: readonly string[];
  } = {},
): ParamSpecGroup => ({
  name,
  params: [
    oscillatorType({
      path: [...path, "type"],
      defaultValue: type,
      options: options(types),
    }),
    detune({ name: `${name} Detune`, path: [...path, "detune"] }),
    ...(types.includes("pulse")
      ? [pulseWidth({ path: [...path, "width"] })]
      : []),
    ...(types.includes("pwm")
      ? [modulationFrequency({ path: [...path, "modulationFrequency"] })]
      : []),
  ],
});

// A Tone Filter under `path`, as a synth's filter section has it.
export const filterGroup = (
  path: readonly string[],
  {
    name = "Filter",
    extra = [],
  }: { readonly name?: string; readonly extra?: readonly ParamSpec[] } = {},
): ParamSpecGroup => ({
  name,
  params: [
    filterType({ path: [...path, "type"] }),
    frequency({
      name: "Cutoff",
      path: [...path, "frequency"],
      defaultValue: 1000,
    }),
    q({ path: [...path, "Q"] }),
    rolloff({ path: [...path, "rolloff"] }),
    ...extra,
  ],
});

// A frequency envelope under `path`: its stages plus where it sweeps from and
// how far.
export const filterEnvelopeGroup = (
  path: readonly string[],
  stages: Stages & { readonly name?: string } = {},
): ParamSpecGroup => {
  const envelope = envelopeGroup(path, { name: "Filter Envelope", ...stages });
  return {
    ...envelope,
    params: [
      ...(envelope.params ?? []),
      frequency({
        name: "Base Frequency",
        path: [...path, "baseFrequency"],
        defaultValue: 200,
        automation: undefined,
      }),
      octaves({ path: [...path, "octaves"], defaultValue: 3 }),
    ],
  };
};
