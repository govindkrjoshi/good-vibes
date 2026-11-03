import { defineItem, delayTime, feedback, toneCode, wet } from "../../../kit";

export default defineItem("effects", "PingPongDelay", {
  description: "An echo that bounces between the left and right channels.",
  code: toneCode("new tone.PingPongDelay()"),
  params: {
    params: [
      wet({ patchable: true }),
      delayTime(),
      feedback({ defaultValue: 0.5 }),
    ],
  },
});
