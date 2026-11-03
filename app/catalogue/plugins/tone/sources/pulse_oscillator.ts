import {
  defineItem,
  detune,
  frequency,
  pulseWidth,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

export default defineItem("sources", "PulseOscillator", {
  description:
    "A pulse wave oscillator with an adjustable pulse width; it runs continuously.",
  code: toneCode("new tone.PulseOscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      pulseWidth({ defaultValue: 0.2, patchable: true }),
    ],
  },
  jacks: sourceJacks(),
});
