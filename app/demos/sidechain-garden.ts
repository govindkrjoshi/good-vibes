import type { Registry } from "../catalogue/registry";
import type { RackState } from "../rack/model";
import { chord, DemoBuilder, inp, mod, out, part, seq } from "./builder";

// A kick and a pad that talk to each other: the kick's level, followed as a
// control signal, ducks the pad through a VCA and closes its filter at the
// same time, each through its own bit of signal math. The master splits
// into mid and side, treats each and joins them again. Twenty racks.
export const sidechainGarden = (registry: Registry): RackState => {
  const b = new DemoBuilder(registry, 112);

  // Voice A: the kick, four to the floor.
  b.add("tone/MembraneSynth", "kick", {
    name: "Kick",
    values: {
      volume: -4,
      pitchDecay: 0.04,
      octaves: 6,
      "envelope.decay": 0.3,
      "envelope.sustain": 0.01,
      "envelope.release": 0.6,
    },
    events: [
      seq(["G1", null, "G1", null, "G1", null, "G1", null], "8n", {
        duration: "16n",
      }),
    ],
  });
  b.add("tone/Compressor", "kickComp", {
    name: "Kick",
    values: {
      threshold: -18,
      ratio: 4,
      attack: 0.005,
      release: 0.12,
      knee: 10,
    },
  });

  // Voice B: the pad, a chord a bar.
  b.add("tone/PolySynth (Synth)", "pad", {
    name: "Pad",
    values: {
      volume: -12,
      "oscillator.type": "sawtooth",
      "envelope.attack": 0.3,
      "envelope.decay": 0.4,
      "envelope.sustain": 0.8,
      "envelope.release": 1.6,
    },
    events: [
      part(
        [
          ...chord("0:0", ["C3", "Eb3", "G3", "Bb3"]),
          ...chord("1:0", ["Ab2", "C3", "Eb3", "G3"]),
          ...chord("2:0", ["F2", "Ab2", "C3", "Eb3", "G3"]),
          ...chord("3:0", ["G2", "C3", "D3", "F3"]),
        ],
        "4m",
        { duration: "1m" },
      ),
    ],
  });
  b.add("tone/Chorus", "chorus", {
    name: "Pad",
    values: { frequency: 0.6, depth: 0.5, wet: 0.35 },
  });
  // Its cutoff follows the kick, so it has no setting of its own.
  b.add("tone/Filter", "padFilter", {
    name: "Pad",
    values: { type: "lowpass", Q: 2, rolloff: -24 },
  });
  // A VCA: the pad times a gain the sidechain sets.
  b.add("tone/Multiply", "padVca", { name: "Duck" });

  // The link: the kick's level as a signal, seen on a meter, then fanned out.
  b.add("tone/Follower", "follower", {
    name: "Sidechain",
    values: { smoothing: 0.06 },
  });
  b.add("tone/DCMeter", "scMeter", { name: "Sidechain" });
  // gain = 1 - 2 × level, so a hit takes the pad most of the way down.
  b.add("tone/Multiply", "duckAmount", {
    name: "Times",
    values: { factor: -2 },
  });
  b.add("tone/Add", "duckOffset", { name: "Plus", values: { addend: 1 } });
  // Level 0 to 1 onto 3000 down to 300 Hz, so the pad darkens as it ducks.
  b.add("tone/Scale", "closeAmount", {
    name: "Cutoff",
    values: { min: 3000, max: 300 },
  });

  // Master: sum, split into mid and side, treat each, join, glue, catch.
  b.add("tone/Channel", "mix", { name: "Mix", values: { volume: -2 } });
  b.add("tone/MidSideSplit", "msSplit", { name: "Master" });
  b.add("tone/EQ3", "midEq", {
    name: "Mid",
    values: { low: 2, mid: -1, high: 0 },
  });
  b.add("tone/Volume", "sideVol", { name: "Side", values: { volume: 3 } });
  b.add("tone/MidSideMerge", "msMerge", { name: "Master" });
  b.add("tone/Reverb", "verb", {
    name: "Glue",
    values: { decay: 2.5, preDelay: 0.02, wet: 0.2 },
  });
  b.add("tone/Limiter", "limiter", {
    name: "Safety",
    values: { threshold: -3 },
  });
  b.add("tone/FFT", "masterFft", {
    name: "Master",
    values: { size: 512, smoothing: 0.85 },
  });
  b.add("tone/Destination", "out");

  b.chain("kick", "kickComp", "mix");
  b.chain("kickComp", "follower", "scMeter");
  b.patch(out("scMeter"), inp("duckAmount", "in"));
  b.patch(out("duckAmount"), inp("duckOffset", "in"));
  b.patch(out("duckOffset"), inp("padVca", "factor"));
  b.patch(out("scMeter"), inp("closeAmount"));
  b.patch(out("closeAmount"), mod("padFilter", "frequency"));

  b.chain("pad", "chorus", "padFilter");
  b.patch(out("padFilter"), inp("padVca", "in"));
  b.chain("padVca", "mix", "msSplit");
  b.patch(out("msSplit", "mid"), inp("midEq"));
  b.patch(out("msSplit", "side"), inp("sideVol"));
  b.patch(out("midEq"), inp("msMerge", "mid"));
  b.patch(out("sideVol"), inp("msMerge", "side"));
  b.chain("msMerge", "verb", "limiter", "masterFft", "out");

  return b.build();
};
