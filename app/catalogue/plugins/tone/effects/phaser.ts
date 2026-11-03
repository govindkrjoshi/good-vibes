import { defineItem, frequency, octaves, q, toneCode, wet } from "../../../kit";

// Phaser starts its own LFOs. Its stage count is fixed when it is built.
export default defineItem("effects", "Phaser", {
  description:
    "Sweeps a chain of allpass filters with an LFO, for a swirling, jet-like sound.",
  code: toneCode("new tone.Phaser()"),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Rate",
        defaultValue: 0.5,
        min: 0,
        max: 20,
        step: 0.01,
        patchable: true,
      }),
      octaves({ defaultValue: 3 }),
      frequency({
        name: "Base Frequency",
        path: ["baseFrequency"],
        defaultValue: 350,
        automation: undefined,
      }),
      q({ defaultValue: 10 }),
    ],
  },
});
