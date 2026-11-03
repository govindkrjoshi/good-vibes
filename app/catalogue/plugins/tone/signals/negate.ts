import { defineItem, toneCode } from "../../../kit";

export default defineItem("signals", "Negate", {
  description:
    "Flips the sign of the signal, so positive becomes negative and back.",
  code: toneCode("new tone.Negate()"),
});
