import { defineItem, delayTime, feedback, toneCode, wet } from "../../../kit";

export default defineItem("effects", "FeedbackDelay", {
  description: "An echo that repeats the sound, fading with each repeat.",
  code: toneCode("new tone.FeedbackDelay()"),
  params: {
    // The delay line is built for at most a second.
    params: [wet({ patchable: true }), delayTime(), feedback()],
  },
});
