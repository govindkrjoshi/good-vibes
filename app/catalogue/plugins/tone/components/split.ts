import { defineItem, indexJack, input, toneCode } from "../../../kit";

// Its output is a native ChannelSplitter, so each side is a numbered output.
export default defineItem("components", "Split", {
  description:
    "Splits a stereo signal into its left and right channels as two mono signals.",
  code: toneCode("new tone.Split()"),
  jacks: [
    input(),
    indexJack("out", "L", "Left", 0),
    indexJack("out", "R", "Right", 1),
  ],
});
