import {
  defineItem,
  detune,
  frequency,
  numberParam,
  oscillatorType,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

const count = numberParam({
  name: "Count",
  path: ["count"],
  defaultValue: 3,
  min: 1,
  max: 10,
  step: 1,
});

const spread = numberParam({
  name: "Spread",
  path: ["spread"],
  defaultValue: 20,
  min: 0,
  max: 200,
  step: 1,
  unit: "cents",
});

export default defineItem("sources", "FatOscillator", {
  description:
    "A stack of detuned oscillators played together for a thick, chorused sound; it runs continuously.",
  code: toneCode("new tone.FatOscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      oscillatorType({ defaultValue: "sawtooth" }),
      count(),
      spread(),
    ],
  },
  jacks: sourceJacks(),
});
