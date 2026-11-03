import {
  automatable,
  defineItem,
  numberParam,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "StereoWidener", {
  description:
    "Widens or narrows the stereo image by balancing the mid and side signals.",
  code: toneCode("new tone.StereoWidener()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Width",
        path: ["width"],
        description:
          "0 is mono, 0.5 leaves the sound as it is, 1 is all sides.",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        automation: automatable,
      })(),
    ],
  },
});
