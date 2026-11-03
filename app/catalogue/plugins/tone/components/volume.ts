import { defineItem, mute, toneCode, volume } from "../../../kit";

export default defineItem("components", "Volume", {
  description: "A volume control in decibels, with a mute.",
  code: toneCode("new tone.Volume()"),
  params: { params: [volume({ patchable: true }), mute()] },
});
