import {
  defineItem,
  frequency,
  numberParam,
  automatable,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "Freeverb", {
  description:
    "A reverb built from comb and allpass filters, with a room size and high-frequency dampening.",
  code: toneCode("new tone.Freeverb()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Room Size",
        path: ["roomSize"],
        defaultValue: 0.7,
        min: 0,
        max: 1,
        step: 0.01,
        automation: automatable,
      })(),
      frequency({
        name: "Dampening",
        path: ["dampening"],
        defaultValue: 3000,
        automation: undefined,
      }),
    ],
  },
});
