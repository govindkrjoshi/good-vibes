import {
  automatable,
  defineItem,
  numberParam,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "BitCrusher", {
  description:
    "Lowers the bit depth of the sound for a gritty, lo-fi digital distortion.",
  code: toneCode("new tone.BitCrusher()"),
  params: {
    params: [
      wet({ patchable: true }),
      numberParam({
        name: "Bits",
        path: ["bits"],
        defaultValue: 4,
        min: 1,
        max: 16,
        step: 1,
        automation: automatable,
      })(),
    ],
  },
});
