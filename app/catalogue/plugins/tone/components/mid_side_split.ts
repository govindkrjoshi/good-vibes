import { defineItem, input, memberJack, toneCode } from "../../../kit";

export default defineItem("components", "MidSideSplit", {
  description:
    "Splits a stereo signal into its mid (what both sides share) and side (where they differ).",
  code: toneCode("new tone.MidSideSplit()"),
  jacks: [
    input(),
    memberJack("out", "mid", "Mid"),
    memberJack("out", "side", "Side"),
  ],
});
