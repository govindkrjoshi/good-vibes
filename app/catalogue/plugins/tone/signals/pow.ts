import { defineItem, numberParam, toneCode } from "../../../kit";

// Tone raises the absolute value, so negative input comes out positive.
export default defineItem("signals", "Pow", {
  description: "Raises the signal to a power, bending its curve.",
  code: toneCode("new tone.Pow()"),
  params: {
    params: [
      numberParam({
        name: "Exponent",
        path: ["value"],
        defaultValue: 1,
        min: 0.1,
        max: 8,
        step: 0.1,
      })(),
    ],
  },
});
