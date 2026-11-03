import type { Registry } from "../catalogue/registry";
import type { RackState } from "../rack/model";
import { DemoBuilder, mod, out, seq } from "./builder";

// One bass line through a resonant filter swept by an LFO, into a feedback
// delay you can push until it runs away, with a limiter to catch it. Ten
// racks: a param driven by a signal, a readout mid-chain watching the echo
// tail build, and another watching the sweep itself.
export const dubPulse = (registry: Registry): RackState => {
  const b = new DemoBuilder(registry, 76);

  b.add("tone/MonoSynth", "bass", {
    name: "Bass",
    values: {
      volume: -6,
      portamento: 0.02,
      "oscillator.type": "sawtooth",
      "envelope.attack": 0.005,
      "envelope.decay": 0.25,
      "envelope.sustain": 0.35,
      "envelope.release": 0.3,
      "filter.Q": 2,
      "filter.rolloff": -24,
      "filterEnvelope.attack": 0.01,
      "filterEnvelope.decay": 0.3,
      "filterEnvelope.sustain": 0.2,
      "filterEnvelope.release": 0.5,
      "filterEnvelope.baseFrequency": 60,
      "filterEnvelope.octaves": 3.5,
    },
    events: [
      seq(
        // Two bars in C minor, with the space a dub line needs.
        [
          "C2",
          null,
          null,
          "C2",
          "Eb2",
          null,
          null,
          null,
          "G1",
          null,
          null,
          "Bb1",
          null,
          "C2",
          null,
          null,
        ],
        "8n",
        { duration: "8n" },
      ),
    ],
  });

  // The sweep: one slow triangle, seen on a meter before it reaches the cutoff.
  b.add("tone/LFO", "sweep", {
    name: "Sweep",
    values: { frequency: 0.12, min: 120, max: 1400, type: "triangle" },
  });
  b.add("tone/DCMeter", "sweepMeter", { name: "Sweep" });

  b.add("tone/Filter", "filter", {
    name: "Dub filter",
    values: { type: "lowpass", Q: 7, rolloff: -24 },
  });
  // A dotted eighth at 76 BPM. Feedback past 0.9 is where the fun starts.
  b.add("tone/FeedbackDelay", "echo", {
    name: "Echo",
    values: { delayTime: 0.59, feedback: 0.55, wet: 0.4 },
  });
  b.add("tone/Meter", "echoMeter", {
    name: "Echo tail",
    values: { smoothing: 0.9 },
  });
  b.add("tone/Reverb", "room", {
    name: "Room",
    values: { decay: 2, wet: 0.25 },
  });
  b.add("tone/Limiter", "limiter", {
    name: "Safety",
    values: { threshold: -6 },
  });
  b.add("tone/Waveform", "scope", { name: "Scope" });
  b.add("tone/Destination", "out");

  b.chain(
    "bass",
    "filter",
    "echo",
    "echoMeter",
    "room",
    "limiter",
    "scope",
    "out",
  );
  b.chain("sweep", "sweepMeter");
  b.patch(out("sweepMeter"), mod("filter", "frequency"));

  return b.build();
};
