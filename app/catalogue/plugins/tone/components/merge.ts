import { defineItem, indexJack, output, toneCode } from "../../../kit";

// Its input is a native ChannelMerger, so each side is a numbered input.
export default defineItem("components", "Merge", {
  description:
    "Joins two mono signals into one stereo signal, the first on the left and the second on the right.",
  code: toneCode("new tone.Merge()"),
  jacks: [
    indexJack("in", "L", "Left", 0),
    indexJack("in", "R", "Right", 1),
    output(),
  ],
});
