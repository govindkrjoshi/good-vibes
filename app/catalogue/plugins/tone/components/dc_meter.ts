import { defineItem, toneCode } from "../../../kit";

export default defineItem("components", "DCMeter", {
  description:
    "Shows the raw value of the signal passing through it, for watching control signals like an LFO.",
  code: toneCode("new tone.DCMeter()"),
  readout: { kind: "dc" },
});
