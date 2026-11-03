import {
  automatable,
  defineItem,
  input,
  memberJack,
  numberParam,
  output,
  toneCode,
} from "../../../kit";

export default defineItem("signals", "Subtract", {
  description:
    "Subtracts a value, or a second signal, from the signal passing through.",
  code: toneCode("new tone.Subtract()"),
  params: {
    params: [
      numberParam({
        name: "Subtrahend",
        path: ["subtrahend"],
        defaultValue: 0,
        step: 0.01,
        automation: automatable,
      })(),
    ],
  },
  // The Subtrahend jack drives the param, so the param isn't patchable as well.
  jacks: [
    input({ key: "in", name: "Input" }),
    memberJack("in", "subtrahend", "Subtrahend"),
    output(),
  ],
});
