import {
  defineItem,
  depth,
  filterType,
  frequency,
  octaves,
  oscillatorType,
  q,
  rolloff,
  toneCode,
  wet,
} from "../../../kit";

export default defineItem("effects", "AutoFilter", {
  description:
    "A filter whose cutoff is swept up and down by an LFO, for a wah-like wobble.",
  code: toneCode("new tone.AutoFilter()", { start: true }),
  params: {
    params: [
      wet({ patchable: true }),
      frequency({
        name: "Rate",
        defaultValue: 1,
        min: 0,
        max: 20,
        step: 0.01,
        patchable: true,
      }),
      depth(),
      oscillatorType({ name: "LFO Type" }),
      frequency({
        name: "Base Frequency",
        path: ["baseFrequency"],
        defaultValue: 200,
        automation: undefined,
      }),
      octaves({ defaultValue: 2.6 }),
    ],
    groups: {
      filter: {
        name: "Filter",
        params: [
          filterType({ path: ["filter", "type"] }),
          rolloff({ path: ["filter", "rolloff"] }),
          q({ path: ["filter", "Q"] }),
        ],
      },
    },
  },
});
