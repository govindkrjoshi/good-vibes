import { defineItem, toneCode } from "../../../kit";

export default defineItem("components", "Mono", {
  description:
    "Sums its input to mono and sends it out on both stereo channels.",
  code: toneCode("new tone.Mono()"),
});
