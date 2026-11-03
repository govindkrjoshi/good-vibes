import {
  defineItem,
  options,
  selectParam,
  smoothing,
  toneCode,
} from "../../../kit";

// Smaller than Tone's 1024, since every frame is sent from the sandbox.
export const analysisSize = selectParam({
  name: "Size",
  path: ["size"],
  defaultValue: 256,
  options: options([64, 128, 256, 512, 1024, 2048]),
});

export default defineItem("components", "FFT", {
  description:
    "Shows the spectrum of the signal passing through it, low frequencies on the left.",
  code: toneCode("new tone.FFT()"),
  params: { params: [analysisSize(), smoothing()] },
  readout: { kind: "spectrum" },
});
