import { defineItem, frequency, toneCode, wet } from "../../../kit";

export default defineItem("effects", "FrequencyShifter", {
  description:
    "Shifts every frequency in the sound by the same number of hertz, which detunes its harmonics into inharmonic, metallic tones.",
  code: toneCode("new tone.FrequencyShifter()"),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Shift",
        defaultValue: 0,
        min: -1000,
        max: 1000,
        patchable: true,
      }),
    ],
  },
});
