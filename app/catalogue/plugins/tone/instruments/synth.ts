import {
  defineItem,
  detune,
  envelopeGroup,
  monophonic,
  oscillatorGroup,
  portamento,
  riff,
  toneCode,
  volume,
} from "../../../kit";
import type { ParamSpecGroup } from "../../../spec";

// Exported so PolySynth can play Synth voices with the same controls.
export const params: ParamSpecGroup = {
  params: [volume(), detune({ patchable: true }), portamento()],
  groups: {
    oscillator: oscillatorGroup(["oscillator"], { type: "triangle" }),
    envelope: envelopeGroup(["envelope"], {
      attack: 0.005,
      decay: 0.1,
      sustain: 0.3,
      release: 1,
    }),
  },
};

export default defineItem("instruments", "Synth", {
  description:
    "A single oscillator shaped by an amplitude envelope, the simplest pitched synth.",
  code: toneCode("new tone.Synth()"),
  params,
  methods: monophonic(),
  events: [riff()],
});
