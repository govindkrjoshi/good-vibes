import { defineItem, mute, pan, toneCode, volume } from "../../../kit";

export default defineItem("components", "Channel", {
  description: "A mixer channel strip with volume, pan and mute.",
  code: toneCode("new tone.Channel()"),
  params: {
    params: [volume({ patchable: true }), pan({ patchable: true }), mute()],
  },
});
