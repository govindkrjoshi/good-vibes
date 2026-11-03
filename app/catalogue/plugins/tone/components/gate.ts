import { defineItem, smoothing, threshold, toneCode } from "../../../kit";

// Both are plain properties, not signals, so neither can be automated.
export default defineItem("components", "Gate", {
  description:
    "A noise gate that silences the signal while it stays below the threshold.",
  code: toneCode("new tone.Gate()"),
  params: {
    params: [
      threshold({ defaultValue: -40, automation: undefined }),
      // How long the level follower takes to respond; zero would divide by zero.
      smoothing({ defaultValue: 0.1, min: 0.01, unit: "s" }),
    ],
  },
});
