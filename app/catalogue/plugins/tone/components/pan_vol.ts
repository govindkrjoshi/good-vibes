import { defineItem, mute, pan, toneCode, volume } from "../../../kit";

export default defineItem("components", "PanVol", {
  description: "A stereo panner and a volume control in one, with a mute.",
  code: toneCode("new tone.PanVol()"),
  params: {
    params: [pan({ patchable: true }), volume({ patchable: true }), mute()],
  },
});
