import {
  defineItem,
  envelopeGroup,
  sequence,
  toneCode,
  unpitched,
} from "../../../kit";

export default defineItem("signals", "AmplitudeEnvelope", {
  description:
    "Shapes the loudness of the audio passing through it with an ADSR envelope each time it is triggered.",
  code: toneCode("new tone.AmplitudeEnvelope()"),
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
});
