import { defineItem, frequency, gain, q, toneCode } from "../../../kit";

export default defineItem("components", "EQ3", {
  description:
    "A three-band equalizer that sets the level of the low, mid and high bands apart.",
  code: toneCode("new tone.EQ3()"),
  params: {
    params: [
      gain({ name: "Low", path: ["low"] }),
      gain({ name: "Mid", path: ["mid"] }),
      gain({ name: "High", path: ["high"] }),
      frequency({
        name: "Low Frequency",
        path: ["lowFrequency"],
        defaultValue: 400,
      }),
      frequency({
        name: "High Frequency",
        path: ["highFrequency"],
        defaultValue: 2500,
      }),
      q(),
    ],
  },
});
