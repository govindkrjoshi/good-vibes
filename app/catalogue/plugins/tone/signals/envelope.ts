import {
  defineItem,
  envelopeGroup,
  output,
  sequence,
  toneCode,
  unpitched,
} from "../../../kit";

// Envelope's input is undefined: it only makes a control signal.
export default defineItem("signals", "Envelope", {
  description:
    "An ADSR control signal from 0 to 1 and back each time it is triggered, for shaping other params.",
  code: toneCode("new tone.Envelope()"),
  params: {
    groups: { envelope: envelopeGroup([], { sustain: 0.5, release: 1 }) },
  },
  methods: unpitched(),
  events: [
    sequence("triggerAttackRelease", {
      steps: [1, null, 1, null],
      args: { duration: "16n" },
    }),
  ],
  jacks: [output()],
});
