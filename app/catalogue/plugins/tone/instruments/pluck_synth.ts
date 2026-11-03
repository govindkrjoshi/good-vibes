import {
  defineItem,
  numberParam,
  release,
  resonance,
  riff,
  toneCode,
  triggerAttack,
  triggerAttackRelease,
  triggerRelease,
  volume,
} from "../../../kit";

const attackNoise = numberParam({
  name: "Attack Noise",
  path: ["attackNoise"],
  defaultValue: 1,
  min: 0.1,
  max: 20,
  step: 0.1,
});

const dampening = numberParam({
  name: "Dampening",
  path: ["dampening"],
  defaultValue: 4000,
  min: 0,
  max: 7000,
  step: 1,
  unit: "Hz",
});

export default defineItem("instruments", "PluckSynth", {
  description:
    "A Karplus-Strong plucked string: a burst of noise ringing through a tuned comb filter.",
  code: toneCode("new tone.PluckSynth()"),
  params: {
    params: [
      volume(),
      attackNoise(),
      dampening(),
      // Read at each attack, so it isn't automatable.
      resonance({ defaultValue: 0.7, automation: undefined }),
      release({ defaultValue: 1 }),
    ],
  },
  // It ignores velocity and has no setNote.
  methods: [
    triggerAttack({
      args: [
        { name: "note", kind: "note" },
        { name: "time", kind: "time", optional: true },
      ],
    }),
    triggerRelease(),
    triggerAttackRelease({
      args: [
        { name: "note", kind: "note" },
        { name: "duration", kind: "time" },
        { name: "time", kind: "time", optional: true },
      ],
    }),
  ],
  events: [riff()],
});
