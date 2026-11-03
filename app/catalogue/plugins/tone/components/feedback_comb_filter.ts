import { defineItem, delayTime, resonance, toneCode } from "../../../kit";

export default defineItem("components", "FeedbackCombFilter", {
  description:
    "A short delay fed back into itself, which rings at the pitch its delay time sets.",
  code: toneCode("new tone.FeedbackCombFilter()"),
  params: {
    params: [delayTime({ defaultValue: 0.1, step: 0.001 }), resonance()],
  },
});
