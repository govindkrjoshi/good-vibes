import { defineItem, smoothing, toneCode } from "../../../kit";

// The panel draws dB, so the level stays in dB rather than Tone's 0-1 option.
export default defineItem("components", "Meter", {
  description: "Shows how loud the signal passing through it is, in decibels.",
  code: toneCode("new tone.Meter()"),
  params: { params: [smoothing()] },
  readout: { kind: "level" },
});
