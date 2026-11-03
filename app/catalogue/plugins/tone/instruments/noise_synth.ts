import {
  defineItem,
  envelopeGroup,
  options,
  selectParam,
  sequence,
  toneCode,
  unpitched,
  volume,
} from "../../../kit";

const noiseType = selectParam({
  name: "Noise Type",
  path: ["noise", "type"],
  defaultValue: "white",
  options: options(["white", "pink", "brown"]),
});

export default defineItem("instruments", "NoiseSynth", {
  description:
    "Noise shaped by an amplitude envelope, for snares, claps and other unpitched hits.",
  code: toneCode("new tone.NoiseSynth()"),
  params: {
    params: [volume(), noiseType()],
    groups: {
      envelope: envelopeGroup(["envelope"], {
        attack: 0.01,
        decay: 0.1,
        sustain: 0,
        release: 1,
      }),
    },
  },
  methods: unpitched(),
  // It takes no note, so any step that isn't a rest is a hit.
  events: [
    sequence("triggerAttackRelease", {
      steps: [1, null, 1, null],
      args: { duration: "16n" },
    }),
  ],
});
