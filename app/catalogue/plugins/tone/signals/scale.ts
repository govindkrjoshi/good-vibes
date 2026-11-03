import { defineItem, numberParam, toneCode } from "../../../kit";

const bound = numberParam({
  name: "Min",
  path: ["min"],
  defaultValue: 0,
  step: 0.01,
});

export default defineItem("signals", "Scale", {
  description:
    "Maps a signal from 0 to 1 linearly onto a range from min to max.",
  code: toneCode("new tone.Scale()"),
  params: {
    params: [bound(), bound({ name: "Max", path: ["max"], defaultValue: 1 })],
  },
});
