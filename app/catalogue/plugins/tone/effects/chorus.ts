import {
  defineItem,
  depth,
  feedback,
  frequency,
  numberParam,
  oscillatorType,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "Chorus", {
  description:
    "Mixes in copies of the sound with slowly wavering delays, for a shimmering, doubled tone.",
  code: toneCode("new tone.Chorus()", { start: true }),
  params: {
    params: [
      wet({ defaultValue: 0.5, patchable: true }),
      frequency({
        name: "Rate",
        defaultValue: 1.5,
        min: 0,
        max: 20,
        step: 0.01,
        patchable: true,
      }),
      // Unlike every other Tone delay time, Chorus's is in milliseconds.
      numberParam({
        name: "Delay Time",
        path: ["delayTime"],
        defaultValue: 3.5,
        min: 2,
        max: 20,
        step: 0.1,
        unit: "ms",
      })(),
      depth({ defaultValue: 0.7, automation: undefined }),
      feedback({ defaultValue: 0 }),
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
