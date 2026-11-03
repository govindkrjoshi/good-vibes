import { defineItem, threshold, toneCode } from "../../../kit";

export default defineItem("components", "Limiter", {
  description:
    "A compressor with a very high ratio that keeps the signal from going above its threshold.",
  code: toneCode("new tone.Limiter()"),
  params: { params: [threshold({ defaultValue: -12 })] },
});
