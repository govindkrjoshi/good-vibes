import { defineItem, numberParam, toneCode } from "../../../kit";

const bound = numberParam({
  name: "Min",
  path: ["min"],
  defaultValue: 0,
  step: 0.01,
});

export default defineItem("signals", "ScaleExp", {
  description:
    "Maps a signal from 0 to 1 onto a range from min to max along an exponential curve.",
  code: toneCode("new tone.ScaleExp()"),
  params: {
    params: [
      bound(),
      bound({ name: "Max", path: ["max"], defaultValue: 1 }),
      numberParam({
        name: "Exponent",
        path: ["exponent"],
        defaultValue: 1,
        min: 0.1,
        max: 8,
        step: 0.1,
      })(),
    ],
  },
});
