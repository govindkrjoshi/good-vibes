import {
  automatable,
  defineItem,
  input,
  memberJack,
  numberParam,
  output,
  toneCode,
} from "../../../kit";

export default defineItem("signals", "Multiply", {
  description:
    "Multiplies the signal passing through by a value, or by a second signal.",
  code: toneCode("new tone.Multiply()"),
  params: {
    params: [
      numberParam({
        name: "Factor",
        path: ["factor"],
        // Tone's default of 0 silences everything; 1 passes it through.
        defaultValue: 1,
        step: 0.01,
        automation: automatable,
      })(),
    ],
  },
  // The Factor jack drives the param, so the param isn't patchable as well.
  jacks: [
    input({ key: "in", name: "Input" }),
    memberJack("in", "factor", "Factor"),
    output(),
  ],
});
