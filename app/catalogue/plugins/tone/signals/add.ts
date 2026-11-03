import {
  automatable,
  defineItem,
  input,
  memberJack,
  numberParam,
  output,
  toneCode,
} from "../../../kit";

export default defineItem("signals", "Add", {
  description:
    "Adds a value, or a second signal, to the signal passing through.",
  code: toneCode("new tone.Add()"),
  params: {
    params: [
      numberParam({
        name: "Addend",
        path: ["addend"],
        defaultValue: 0,
        step: 0.01,
        automation: automatable,
      })(),
    ],
  },
  // The Addend jack drives the param, so the param isn't patchable as well.
  jacks: [
    input({ key: "in", name: "Input" }),
    memberJack("in", "addend", "Addend"),
    output(),
  ],
});
