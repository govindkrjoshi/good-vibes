import {
  defineItem,
  detune,
  envelopeGroup,
  harmonicity,
  modulationIndex,
  monophonic,
  oscillatorGroup,
  oscillatorType,
  portamento,
  riff,
  toneCode,
  volume,
} from "../../../kit";
import type { ParamSpecGroup } from "../../../spec";

// Exported so PolySynth can play FMSynth voices with the same controls.
export const params: ParamSpecGroup = {
  params: [
    volume(),
    detune({ patchable: true }),
    portamento(),
    harmonicity(),
    modulationIndex(),
  ],
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

export default defineItem("instruments", "FMSynth", {
  description:
    "A synth whose carrier oscillator's frequency is modulated by a second oscillator, for bright, metallic and electric piano tones.",
  code: toneCode("new tone.FMSynth()"),
  params,
  methods: monophonic(),
  events: [riff()],
});
