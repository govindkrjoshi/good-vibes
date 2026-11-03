import {
  defineItem,
  numberParam,
  options,
  selectParam,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

export default defineItem("sources", "Noise", {
  description:
    "A noise generator making white, pink or brown noise; it runs continuously.",
  code: toneCode("new tone.Noise()", { start: true }),
  params: {
    params: [
      volume(),
      selectParam({
        name: "Type",
        path: ["type"],
        defaultValue: "white",
        options: options(["white", "pink", "brown"]),
      })(),
      numberParam({
        name: "Playback Rate",
        path: ["playbackRate"],
        defaultValue: 1,
        min: 0.1,
        max: 4,
        step: 0.01,
      })(),
      numberParam({
        name: "Fade In",
        path: ["fadeIn"],
        defaultValue: 0,
        min: 0,
        max: 5,
        step: 0.01,
        unit: "s",
      })(),
      numberParam({
        name: "Fade Out",
        path: ["fadeOut"],
        defaultValue: 0,
        min: 0,
        max: 5,
        step: 0.01,
        unit: "s",
      })(),
    ],
  },
  jacks: sourceJacks(),
});
