import {
  defineItem,
  frequency,
  gain,
  numberParam,
  octaves,
  q,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "AutoWah", {
  description:
    "A filter that opens as the input gets louder, for an envelope-following wah.",
  code: toneCode("new tone.AutoWah()"),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Base Frequency",
        path: ["baseFrequency"],
        defaultValue: 100,
        automation: undefined,
      }),
      octaves({ defaultValue: 6 }),
      numberParam({
        name: "Sensitivity",
        path: ["sensitivity"],
        defaultValue: 0,
        min: -40,
        max: 0,
        step: 1,
        unit: "dB",
      })(),
      q({ defaultValue: 2 }),
      gain({ defaultValue: 2 }),
      numberParam({
        name: "Follower",
        path: ["follower"],
        description: "How quickly the filter follows the input's level.",
        defaultValue: 0.2,
        min: 0,
        max: 1,
        step: 0.01,
        unit: "s",
      })(),
    ],
  },
});
