import {
  defineItem,
  detune,
  frequency,
  oscillatorType,
  phase,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

export default defineItem("sources", "Oscillator", {
  description:
    "A basic oscillator with a sine, square, triangle or sawtooth wave; it runs continuously.",
  code: toneCode("new tone.Oscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      oscillatorType(),
      phase(),
    ],
  },
  jacks: sourceJacks(),
});
