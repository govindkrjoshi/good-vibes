import { defineItem, frequency, toneCode } from "../../../kit";
import { compressorGroup } from "./compressor";

const midAndHigh = {
  threshold: -24,
  ratio: 3,
  attack: 0.02,
  release: 0.03,
  knee: 16,
};

export default defineItem("components", "MultibandCompressor", {
  description:
    "Three compressors, one each for the low, mid and high bands, split at two crossover frequencies.",
  code: toneCode("new tone.MultibandCompressor()"),
  params: {
    params: [
      frequency({
        name: "Low Frequency",
        path: ["lowFrequency"],
        defaultValue: 250,
      }),
      frequency({
        name: "High Frequency",
        path: ["highFrequency"],
        defaultValue: 2000,
      }),
    ],
    groups: {
      low: compressorGroup(["low"], "Low", {
        threshold: -30,
        ratio: 6,
        attack: 0.03,
        release: 0.25,
        knee: 10,
      }),
      mid: compressorGroup(["mid"], "Mid", midAndHigh),
      high: compressorGroup(["high"], "High", midAndHigh),
    },
  },
});
