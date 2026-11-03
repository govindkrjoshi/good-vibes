import {
  automatable,
  defineItem,
  input,
  memberJack,
  numberParam,
  output,
  toneCode,
} from "../../../kit";

export default defineItem("signals", "GreaterThan", {
  description:
    "Outputs 1 while the signal is above a comparator value or signal, and 0 otherwise.",
  code: toneCode("new tone.GreaterThan()"),
  params: {
    params: [
      numberParam({
        name: "Comparator",
        path: ["comparator"],
        defaultValue: 0,
        step: 0.01,
        automation: automatable,
      })(),
    ],
  },
  // The Comparator jack drives the param, so the param isn't patchable as well.
  jacks: [
    input({ key: "in", name: "Input" }),
    memberJack("in", "comparator", "Comparator"),
    output(),
  ],
});
