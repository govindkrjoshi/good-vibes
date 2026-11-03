import { defineItem, toneCode } from "../../../kit";

export default defineItem("signals", "Abs", {
  description:
    "Outputs the absolute value of the signal, flipping negative values positive.",
  code: toneCode("new tone.Abs()"),
});
