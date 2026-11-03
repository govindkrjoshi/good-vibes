import {
  defineItem,
  riff,
  toneCode,
  triggerAttack,
  triggerAttackRelease,
} from "../../../kit";
import type { ParamSpec, ParamSpecGroup } from "../../../spec";
import { params as amSynth } from "./am_synth";
import { params as duoSynth } from "./duo_synth";
import { params as fmSynth } from "./fm_synth";
import { params as membraneSynth } from "./membrane_synth";
import { params as monoSynth } from "./mono_synth";
import { params as synth } from "./synth";

const voices: readonly (readonly [string, ParamSpecGroup])[] = [
  ["Synth", synth],
  ["AMSynth", amSynth],
  ["FMSynth", fmSynth],
  ["DuoSynth", duoSynth],
  ["MonoSynth", monoSynth],
  ["MembraneSynth", membraneSynth],
];

// PolySynth sets each param on every voice, so none of them is one Tone
// Param a cable could drive. Its params are checked against a voice's get(),
// which leaves out an oscillator's detune and the knobs only some waveforms
// read, so those are dropped; the voice's own detune still reaches them all.
const unreachable = ["detune", "width", "modulationFrequency"];

const forVoices = (group: ParamSpecGroup): ParamSpecGroup => ({
  ...group,
  params: group.params
    ?.filter(
      ({ path }) => path.length === 1 || !unreachable.includes(path.at(-1)!),
    )
    .map(
      (param) =>
        Object.fromEntries(
          Object.entries(param).filter(([key]) => key !== "patchable"),
        ) as ParamSpec,
    ),
  groups:
    group.groups &&
    Object.fromEntries(
      Object.entries(group.groups).map(([key, held]) => [key, forVoices(held)]),
    ),
});

export default voices.map(([voice, params]) =>
  defineItem("instruments", `PolySynth (${voice})`, {
    description: `Up to eight ${voice} voices at once, so notes can overlap and ring out.`,
    code: toneCode(
      `new tone.PolySynth({ voice: tone.${voice}, maxPolyphony: 8 })`,
    ),
    params: forVoices(params),
    methods: [
      triggerAttack(),
      {
        name: "Trigger Release",
        method: "triggerRelease",
        args: [
          { name: "note", kind: "note" },
          { name: "time", kind: "time", optional: true },
        ],
      },
      triggerAttackRelease(),
      {
        name: "Release All",
        method: "releaseAll",
        args: [{ name: "time", kind: "time", optional: true }],
      },
    ],
    events: [riff()],
  }),
);
