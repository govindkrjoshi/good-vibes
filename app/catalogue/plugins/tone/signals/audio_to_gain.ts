import { defineItem, toneCode } from "../../../kit";

export default defineItem("signals", "AudioToGain", {
  description:
    "Maps an audio-range signal from -1 to 1 onto the gain range 0 to 1.",
  code: toneCode("new tone.AudioToGain()"),
});
