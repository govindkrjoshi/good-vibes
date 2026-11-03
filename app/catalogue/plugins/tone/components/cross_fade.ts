import {
  automatable,
  defineItem,
  memberJack,
  numberParam,
  output,
  toneCode,
} from "../../../kit";

// CrossFade has no `input` of its own: the two sides are its `a` and `b`.
export default defineItem("components", "CrossFade", {
  description:
    "Blends two signals into one, from all of A at a fade of 0 to all of B at 1.",
  code: toneCode("new tone.CrossFade()"),
  params: {
    params: [
      numberParam({
        name: "Fade",
        path: ["fade"],
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        automation: automatable,
      })({ patchable: true }),
    ],
  },
  jacks: [memberJack("in", "a", "A"), memberJack("in", "b", "B"), output()],
});
