import { defineItem, toneCode } from "../../../kit";
import { analysisSize } from "./fft";

export default defineItem("components", "Waveform", {
  description:
    "Shows the shape of the signal passing through it, like an oscilloscope.",
  code: toneCode("new tone.Waveform()"),
  params: { params: [analysisSize()] },
  readout: { kind: "waveform" },
});
