import { defineItem, toneCode } from "../../../kit";
import { compressorGroup } from "./compressor";

export default defineItem("components", "MidSideCompressor", {
  description:
    "Two compressors, one for what the left and right channels share and one for where they differ.",
  code: toneCode("new tone.MidSideCompressor()"),
  params: {
    groups: {
      mid: compressorGroup(["mid"], "Mid", {
        threshold: -24,
        ratio: 3,
        attack: 0.02,
        release: 0.03,
        knee: 16,
      }),
      side: compressorGroup(["side"], "Side", {
        threshold: -30,
        ratio: 6,
        attack: 0.03,
        release: 0.25,
        knee: 10,
      }),
    },
  },
});
