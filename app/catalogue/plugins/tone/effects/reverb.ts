import { defineItem, numberParam, toneCode, wet } from "../../../kit";

// Reverb is silent until its impulse response is ready. That is built
// asynchronously and rebuilt on every change to decay or pre-delay, so both
// take coarse steps.
export default defineItem("effects", "Reverb", {
  description:
    "A convolution reverb whose impulse response is generated from a decay time.",
  code: toneCode("new tone.Reverb()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Decay",
        path: ["decay"],
        defaultValue: 1.5,
        min: 0.5,
        max: 10,
        step: 0.5,
        unit: "s",
      })(),
      numberParam({
        name: "Pre-delay",
        path: ["preDelay"],
        defaultValue: 0.01,
        min: 0,
        max: 0.5,
        step: 0.01,
        unit: "s",
      })(),
    ],
  },
});
