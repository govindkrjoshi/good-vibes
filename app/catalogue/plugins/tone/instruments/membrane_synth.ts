import {
  defineItem,
  detune,
  envelopeGroup,
  monophonic,
  numberParam,
  octaves,
  oscillatorGroup,
  pulse,
  toneCode,
  volume,
} from "../../../kit";
import type { ParamSpecGroup } from "../../../spec";

const pitchDecay = numberParam({
  name: "Pitch Decay",
  path: ["pitchDecay"],
  defaultValue: 0.05,
  min: 0,
  max: 0.5,
  step: 0.01,
  unit: "s",
});

// Exported so PolySynth can play MembraneSynth voices with the same controls.
// It has no portamento: each note sweeps down from `octaves` above instead.
export const params: ParamSpecGroup = {
  params: [
    volume(),
    detune({ patchable: true }),
    pitchDecay(),
    octaves({ defaultValue: 10, max: 16 }),
  ],
  groups: {
    oscillator: oscillatorGroup(["oscillator"]),
    envelope: envelopeGroup(["envelope"], {
      attack: 0.001,
      decay: 0.4,
      sustain: 0.01,
      release: 1.4,
    }),
  },
};

export default defineItem("instruments", "MembraneSynth", {
  description:
    "An oscillator whose pitch drops quickly after each hit, for kick drums and toms.",
  code: toneCode("new tone.MembraneSynth()"),
  params,
  methods: monophonic(),
  events: [pulse("C1")],
});
