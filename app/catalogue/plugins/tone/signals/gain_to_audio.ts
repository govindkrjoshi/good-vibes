import { defineItem, toneCode } from "../../../kit";

export default defineItem("signals", "GainToAudio", {
  description:
    "Maps a gain-range signal from 0 to 1 onto the audio range -1 to 1.",
  code: toneCode("new tone.GainToAudio()"),
});
