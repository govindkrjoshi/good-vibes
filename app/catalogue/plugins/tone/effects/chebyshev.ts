import {
  defineItem,
  numberParam,
  options,
  selectParam,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "Chebyshev", {
  description:
    "A waveshaper that adds harmonics using a Chebyshev polynomial, from warm to harsh as the order rises.",
  code: toneCode("new tone.Chebyshev()"),
  params: {
    params: [
      wet({ patchable: true }),
      // Tone throws on an order that isn't a whole number.
      numberParam({
        name: "Order",
        path: ["order"],
        defaultValue: 1,
        min: 1,
        max: 100,
        step: 1,
      })(),
      selectParam({
        name: "Oversample",
        path: ["oversample"],
        defaultValue: "none",
        options: options(["none", "2x", "4x"]),
      })(),
    ],
  },
});
