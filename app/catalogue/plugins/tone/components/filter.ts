import {
  defineItem,
  detune,
  filterType,
  frequency,
  gain,
  q,
  rolloff,
  toneCode,
} from "../../../kit";

export default defineItem("components", "Filter", {
  description:
    "A filter that cuts or boosts frequencies, with a steeper rolloff made by chaining biquad filters.",
  code: toneCode("new tone.Filter()"),
  params: {
    params: [
      filterType(),
      frequency({ defaultValue: 350, patchable: true }),
      q({ patchable: true }),
      rolloff(),
      detune(),
      gain({ description: "Only the shelf and peaking types use it." }),
    ],
  },
});
