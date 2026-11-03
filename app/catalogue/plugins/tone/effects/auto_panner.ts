import {
  defineItem,
  depth,
  frequency,
  oscillatorType,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "AutoPanner", {
  description: "Sweeps the sound between left and right with an LFO.",
  code: toneCode("new tone.AutoPanner()", { start: true }),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Rate",
        defaultValue: 1,
        min: 0,
        max: 20,
        step: 0.01,
        patchable: true,
      }),
      depth(),
      oscillatorType({ name: "LFO Type" }),
    ],
  },
});
