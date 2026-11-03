import { defineItem, numberParam, output, toneCode } from "../../../kit";

// Signal's input is its own value param; a jack there would duplicate the
// knob, so it is only a source.
export default defineItem("signals", "Signal", {
  description: "A constant control signal at a value you set.",
  code: toneCode("new tone.Signal()"),
  params: {
    params: [
      numberParam({
        name: "Value",
        path: ["value"],
        defaultValue: 0,
        step: 0.01,
      })(),
    ],
  },
  jacks: [output()],
});
