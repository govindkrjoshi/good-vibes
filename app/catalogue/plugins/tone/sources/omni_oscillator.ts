import {
  basicTypes,
  defineItem,
  detune,
  frequency,
  harmonicity,
  modulationFrequency,
  modulationIndex,
  numberParam,
  oscillatorType,
  options,
  pulseWidth,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

const types = [
  ...basicTypes,
  "pulse",
  "pwm",
  ...["fat", "fm", "am"].flatMap((prefix) =>
    basicTypes.map((type) => `${prefix}${type}`),
  ),
];

// Changing the type swaps the oscillator inside, so the knobs below it only
// reach the waveforms that have them, and Tone ignores the rest. They read as
// undefined on other waveforms, so none of them can be patched.
export default defineItem("sources", "OmniOscillator", {
  description:
    "One oscillator that can be any of Tone's kinds, from a plain wave to pulse, PWM, fat, FM or AM; it runs continuously.",
  code: toneCode("new tone.OmniOscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      oscillatorType({ defaultValue: "pwm", options: options(types) }),
      pulseWidth({ defaultValue: 0.2 }),
      modulationFrequency(),
      numberParam({
        name: "Count",
        path: ["count"],
        defaultValue: 3,
        min: 1,
        max: 10,
        step: 1,
      })(),
      numberParam({
        name: "Spread",
        path: ["spread"],
        defaultValue: 20,
        min: 0,
        max: 200,
        step: 1,
        unit: "cents",
      })(),
      harmonicity({ defaultValue: 1 }),
      modulationIndex({ defaultValue: 2 }),
      oscillatorType({
        name: "Modulation Type",
        path: ["modulationType"],
        defaultValue: "square",
      }),
    ],
  },
  jacks: sourceJacks(),
});
