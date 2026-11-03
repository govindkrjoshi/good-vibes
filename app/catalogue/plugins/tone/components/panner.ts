import { defineItem, pan, toneCode } from "../../../kit";

export default defineItem("components", "Panner", {
  description: "A stereo panner that places the signal between left and right.",
  code: toneCode("new tone.Panner()"),
  params: { params: [pan({ patchable: true })] },
});
