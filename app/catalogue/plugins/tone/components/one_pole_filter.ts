import {
  defineItem,
  frequency,
  options,
  selectParam,
  toneCode,
} from "../../../kit";

const onePoleType = selectParam({
  name: "Type",
  path: ["type"],
  defaultValue: "lowpass",
  options: options(["lowpass", "highpass"]),
});

// Its frequency is a plain property that rebuilds the filter, not a signal,
// so it can't be patched or automated.
export default defineItem("components", "OnePoleFilter", {
  description: "A very gentle 6 dB per octave lowpass or highpass filter.",
  code: toneCode("new tone.OnePoleFilter()"),
  params: {
    params: [
      onePoleType(),
      frequency({ defaultValue: 880, automation: undefined }),
    ],
  },
});
