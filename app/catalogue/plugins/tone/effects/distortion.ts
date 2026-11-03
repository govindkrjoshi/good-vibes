import {
  defineItem,
  numberParam,
  options,
  selectParam,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "Distortion", {
  description: "A waveshaping distortion that overdrives the sound.",
  code: toneCode("new tone.Distortion()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Distortion",
        path: ["distortion"],
        defaultValue: 0.4,
        min: 0,
        max: 1,
        step: 0.01,
      })(),
      selectParam({
        name: "Oversample",
        path: ["oversample"],
        defaultValue: "none",
        options: options(["none", "2x", "4x"]),
      })(),
    ],
  },
});
