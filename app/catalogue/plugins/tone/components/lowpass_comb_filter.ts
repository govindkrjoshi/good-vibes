import {
  defineItem,
  delayTime,
  frequency,
  resonance,
  toneCode,
} from "../../../kit";

export default defineItem("components", "LowpassCombFilter", {
  description:
    "A feedback comb filter with a lowpass filter on its input that darkens the ringing.",
  code: toneCode("new tone.LowpassCombFilter()"),
  params: {
    params: [
      delayTime({ defaultValue: 0.1, step: 0.001 }),
      resonance(),
      // A plain property on the inner one-pole filter, not a signal.
      frequency({
        name: "Dampening",
        path: ["dampening"],
        defaultValue: 3000,
        automation: undefined,
      }),
    ],
  },
});
