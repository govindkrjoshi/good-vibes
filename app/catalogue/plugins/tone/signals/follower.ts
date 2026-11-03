import { defineItem, smoothing, toneCode } from "../../../kit";

// Tone filters at 1 / smoothing Hz, so smoothing can't be 0.
export default defineItem("signals", "Follower", {
  description:
    "Follows the loudness of a signal as a smooth control signal, for envelope-following effects.",
  code: toneCode("new tone.Follower()"),
  params: {
    params: [
      smoothing({ defaultValue: 0.05, min: 0.001, step: 0.001, unit: "s" }),
    ],
  },
});
