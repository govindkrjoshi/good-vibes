import { defineItem, memberJack, output, toneCode } from "../../../kit";

export default defineItem("components", "MidSideMerge", {
  description:
    "Joins a mid and a side signal back into a stereo signal, the reverse of MidSideSplit.",
  code: toneCode("new tone.MidSideMerge()"),
  jacks: [
    memberJack("in", "mid", "Mid"),
    memberJack("in", "side", "Side"),
    output(),
  ],
});
