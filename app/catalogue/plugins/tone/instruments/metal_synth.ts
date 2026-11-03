import {
  attack,
  decay,
  defineItem,
  detune,
  harmonicity,
  modulationIndex,
  monophonic,
  numberParam,
  octaves,
  pulse,
  release,
  toneCode,
  volume,
} from "../../../kit";

// Unlike the other synths, these are plain numbers spread over six
// oscillators, so they can't be automated.
const resonance = numberParam({
  name: "Resonance",
  path: ["resonance"],
  defaultValue: 4000,
  min: 0,
  max: 7000,
  step: 1,
  unit: "Hz",
});

export default defineItem("instruments", "MetalSynth", {
  description:
    "Six inharmonic FM oscillators through a swept highpass filter, for hi-hats, cymbals and bells.",
  code: toneCode("new tone.MetalSynth()"),
  params: {
    params: [
      volume(),
      detune({ patchable: true }),
      harmonicity({
        defaultValue: 5.1,
        min: 0.1,
        max: 10,
        automation: undefined,
      }),
      modulationIndex({ defaultValue: 32, min: 1, automation: undefined }),
      resonance(),
      octaves({ defaultValue: 1.5 }),
    ],
    groups: {
      // MetalSynth holds its sustain at 0, so its envelope has three stages.
      envelope: {
        name: "Envelope",
        params: [
          attack({ path: ["envelope", "attack"], defaultValue: 0.001 }),
          decay({ path: ["envelope", "decay"], defaultValue: 1.4 }),
          release({ path: ["envelope", "release"], defaultValue: 0.2 }),
        ],
      },
    },
  },
  methods: monophonic(),
  events: [pulse(200)],
});
