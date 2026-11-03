import {
  defineItem,
  detune,
  frequency,
  harmonicity,
  oscillatorType,
  sourceJacks,
  toneCode,
  volume,
} from "../../../kit";

// An oscillator makes no sound until started, and has no trigger method to
// start it later, so it runs from the moment it is built.
export default defineItem("sources", "AMOscillator", {
  description:
    "An oscillator whose amplitude is modulated by a second oscillator; it runs continuously.",
  code: toneCode("new tone.AMOscillator()", { start: true }),
  params: {
    params: [
      volume(),
      frequency({ patchable: true }),
      detune({ patchable: true }),
      oscillatorType(),
      harmonicity({ defaultValue: 1 }),
      oscillatorType({
        name: "Modulation Type",
        path: ["modulationType"],
        defaultValue: "square",
      }),
    ],
  },
  jacks: sourceJacks(),
});
