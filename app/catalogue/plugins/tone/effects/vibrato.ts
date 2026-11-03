import {
  defineItem,
  depth,
  frequency,
  oscillatorType,
  toneCode,
  wet,
} from "../../../kit";

// Vibrato starts its own LFO.
export default defineItem("effects", "Vibrato", {
  description: "Wobbles the pitch up and down with an LFO.",
  code: toneCode("new tone.Vibrato()"),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Rate",
        defaultValue: 5,
        min: 0,
        max: 20,
        step: 0.01,
        patchable: true,
      }),
      depth({ defaultValue: 0.1 }),
      oscillatorType({ name: "LFO Type" }),
    ],
  },
});
