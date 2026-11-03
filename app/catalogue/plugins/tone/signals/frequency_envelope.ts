import {
  defineItem,
  envelopeGroup,
  frequency,
  numberParam,
  octaves,
  output,
  sequence,
  toneCode,
  unpitched,
} from "../../../kit";

// Its `input` is the internal Pow the envelope runs through, not somewhere
// to send audio, so it gets no in jack.
export default defineItem("signals", "FrequencyEnvelope", {
  description:
    "An ADSR envelope that sweeps a frequency up from a base by some octaves, for driving a filter or pitch.",
  code: toneCode("new tone.FrequencyEnvelope()"),
  params: {
    params: [
      frequency({
        name: "Base Frequency",
        path: ["baseFrequency"],
        defaultValue: 200,
        automation: undefined,
      }),
      octaves({ defaultValue: 4 }),
      numberParam({
        name: "Exponent",
        path: ["exponent"],
        defaultValue: 1,
        min: 0.1,
        max: 8,
        step: 0.1,
      })(),
    ],
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
