import {
  defineItem,
  detune,
  envelopeGroup,
  harmonicity,
  monophonic,
  oscillatorGroup,
  oscillatorType,
  portamento,
  riff,
  toneCode,
  volume,
} from "../../../kit";
import type { ParamSpecGroup } from "../../../spec";

// Exported so PolySynth can play AMSynth voices with the same controls.
export const params: ParamSpecGroup = {
  params: [volume(), detune(), portamento(), harmonicity()],
  groups: {
    oscillator: oscillatorGroup(["oscillator"]),
    envelope: envelopeGroup(["envelope"], { decay: 0.01 }),
    modulation: {
      name: "Modulation",
      params: [
        oscillatorType({
          path: ["modulation", "type"],
          defaultValue: "square",
        }),
        detune({ name: "Modulation Detune", path: ["modulation", "detune"] }),
      ],
    },
    modulationEnvelope: envelopeGroup(["modulationEnvelope"], {
      name: "Modulation Envelope",
      attack: 0.5,
      decay: 0,
    }),
  },
};

export default defineItem("instruments", "AMSynth", {
  description:
    "A synth whose carrier oscillator's amplitude is modulated by a second oscillator, for bell-like and tremolo tones.",
  code: toneCode("new tone.AMSynth()"),
  params,
  methods: monophonic(),
  events: [riff()],
});
