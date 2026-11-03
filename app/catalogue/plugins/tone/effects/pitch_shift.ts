import {
  defineItem,
  delayTime,
  feedback,
  numberParam,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "PitchShift", {
  description:
    "Shifts the pitch of the sound up or down by semitones without changing its speed.",
  code: toneCode("new tone.PitchShift()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Pitch",
        path: ["pitch"],
        defaultValue: 0,
        min: -24,
        max: 24,
        step: 1,
        unit: "semitones",
      })(),
      numberParam({
        name: "Window Size",
        path: ["windowSize"],
        description: "Shorter windows suit higher sounds.",
        defaultValue: 0.1,
        min: 0.01,
        max: 0.5,
        step: 0.01,
        unit: "s",
      })(),
      delayTime({ defaultValue: 0 }),
      feedback({ defaultValue: 0 }),
    ],
  },
});
