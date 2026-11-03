import {
  automatable,
  defineItem,
  frequency,
  input,
  memberJack,
  q,
  toneCode,
} from "../../../kit";

// It has no output of its own, only the three bands.
export default defineItem("components", "MultibandSplit", {
  description:
    "Splits a signal into low, mid and high bands at two crossover frequencies.",
  code: toneCode("new tone.MultibandSplit()"),
  params: {
    params: [
      frequency({
        name: "Low Frequency",
        path: ["lowFrequency"],
        defaultValue: 400,
        automation: automatable,
      }),
      frequency({
        name: "High Frequency",
        path: ["highFrequency"],
        defaultValue: 2500,
        automation: automatable,
      }),
      q(),
    ],
  },
  jacks: [
    input(),
    memberJack("out", "low", "Low"),
    memberJack("out", "mid", "Mid"),
    memberJack("out", "high", "High"),
  ],
});
