import { defineItem, toneCode } from "../../../kit";

export default defineItem("signals", "GreaterThanZero", {
  description: "Outputs 1 while the signal is above zero and 0 otherwise.",
  code: toneCode("new tone.GreaterThanZero()"),
});
