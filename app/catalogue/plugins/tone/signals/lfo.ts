import {
  automatable,
  defineItem,
  frequency,
  numberParam,
  oscillatorType,
  output,
  phase,
  toneCode,
} from "../../../kit";

const range = numberParam({
  name: "Min",
  path: ["min"],
  defaultValue: 0,
  step: 0.01,
});

// An LFO sits still until started, and has no trigger to start it later.
export default defineItem("signals", "LFO", {
  description:
    "A slow oscillator that sweeps between a min and a max, for modulating other params.",
  code: toneCode("new tone.LFO()", { start: true }),
  params: {
    params: [
      frequency({
        defaultValue: 1,
        min: 0,
        max: 20,
        step: 0.01,
        patchable: true,
      }),
      range(),
      range({ name: "Max", path: ["max"], defaultValue: 1 }),
      oscillatorType(),
      numberParam({
        name: "Amplitude",
        path: ["amplitude"],
        defaultValue: 1,
        min: 0,
        max: 1,
        step: 0.01,
        automation: automatable,
      })(),
      phase(),
    ],
  },
  jacks: [output()],
});
