import {
  defineItem,
  detune,
  filterType,
  frequency,
  gain,
  q,
  toneCode,
} from "../../../kit";

export default defineItem("components", "BiquadFilter", {
  description:
    "A single Web Audio biquad filter, for a gentle 12 dB per octave cut or boost.",
  code: toneCode("new tone.BiquadFilter()"),
  params: {
    params: [
      filterType(),
      frequency({ defaultValue: 350, patchable: true }),
      q({ patchable: true }),
      detune(),
      gain({ description: "Only the shelf and peaking types use it." }),
    ],
  },
});
