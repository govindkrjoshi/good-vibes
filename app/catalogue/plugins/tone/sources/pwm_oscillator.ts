import {
  defineItem,
  detune,
  frequency,
  modulationFrequency,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

export default defineItem("sources", "PWMOscillator", {
  description:
    "A pulse oscillator whose pulse width is swept by a second oscillator, for a moving, hollow tone; it runs continuously.",
  code: toneCode("new tone.PWMOscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      modulationFrequency({ patchable: true }),
    ],
  },
  jacks: sourceJacks(),
});
