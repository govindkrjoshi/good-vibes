import {
  automatable,
  defineItem,
  numberParam,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "JCReverb", {
  description:
    "A simple, metallic reverb modelled on the classic Stanford CCRMA design.",
  code: toneCode("new tone.JCReverb()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Room Size",
        path: ["roomSize"],
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        automation: automatable,
      })(),
    ],
  },
});
