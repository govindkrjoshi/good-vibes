import {
  defineItem,
  detune,
  frequency,
  harmonicity,
  modulationIndex,
  oscillatorType,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

export default defineItem("sources", "FMOscillator", {
  description:
    "An oscillator whose frequency is modulated by a second oscillator, for bright, metallic tones; it runs continuously.",
  code: toneCode("new tone.FMOscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      oscillatorType(),
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
