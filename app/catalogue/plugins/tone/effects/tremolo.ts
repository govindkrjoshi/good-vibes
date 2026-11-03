import {
  defineItem,
  depth,
  frequency,
  numberParam,
  oscillatorType,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "Tremolo", {
  description: "Pulses the volume up and down with an LFO.",
  code: toneCode("new tone.Tremolo()", { start: true }),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Rate",
        defaultValue: 10,
        min: 0,
        max: 40,
        step: 0.01,
        patchable: true,
      }),
      depth({ defaultValue: 0.5 }),
      oscillatorType({ name: "LFO Type" }),
      numberParam({
        name: "Spread",
        path: ["spread"],
        defaultValue: 180,
        min: 0,
        max: 360,
        step: 1,
        unit: "deg",
      })(),
    ],
  },
});
