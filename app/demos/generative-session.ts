import type { Registry } from "../catalogue/registry";
import type { RackState } from "../rack/model";
import {
  chord,
  DemoBuilder,
  every,
  inp,
  mod,
  out,
  part,
  pattern,
  seq,
} from "./builder";

// A piece that plays itself: a hundred racks in eight groups. One group makes
// nothing but control signals and the rest take them through their jacks, so
// a filter in the bass, the blend of the chords, the lead's tuning and the
// drone's pitch all follow the same slow clocks. It also keeps the audio
// library's work per note down: see the hat and the master. Sequences of different
// lengths phase against each other, so the groove never quite repeats.
export const generativeSession = (registry: Registry): RackState => {
  const b = new DemoBuilder(registry, 96);

  // Clock & Harmony: control signals, each seen on a meter before it leaves.
  const brain = b.tree("brain", "Clock & Harmony", {
    outputs: ["Slow", "Gate", "Drift", "Root", "Fifth", "Octave", "Swell"],
  });
  const inBrain = { parentId: brain };
  // A fifty-second sine from 0 to 1.
  b.add("tone/LFO", "brain.slowLfo", {
    ...inBrain,
    name: "Slow clock",
    values: { frequency: 0.02, min: 0, max: 1, type: "sine" },
  });
  b.add("tone/DCMeter", "brain.slowMeter", { ...inBrain, name: "Slow" });
  // A four-bar sine, squared off into a gate that is on a little over half the time.
  b.add("tone/LFO", "brain.gateLfo", {
    ...inBrain,
    name: "Bar clock",
    values: { frequency: 0.1, min: 0, max: 1, type: "sine" },
  });
  b.add("tone/GreaterThan", "brain.gate", {
    ...inBrain,
    name: "Gate",
    values: { comparator: 0.4 },
  });
  b.add("tone/DCMeter", "brain.gateMeter", { ...inBrain, name: "Gate" });
  // A drift of a few cents either way, over a minute and a bit.
  b.add("tone/LFO", "brain.driftLfo", {
    ...inBrain,
    name: "Drift",
    values: { frequency: 0.013, min: -12, max: 12, type: "triangle" },
  });
  b.add("tone/DCMeter", "brain.driftMeter", { ...inBrain, name: "Drift" });
  // The root as a frequency, and a fifth and an octave derived from it. Turn
  // the root and the drone follows.
  b.add("tone/Signal", "brain.root", {
    ...inBrain,
    name: "Root (D2)",
    values: { value: 73.42 },
  });
  b.add("tone/DCMeter", "brain.rootMeter", { ...inBrain, name: "Root" });
  b.add("tone/Multiply", "brain.fifth", {
    ...inBrain,
    name: "Fifth",
    values: { factor: 1.5 },
  });
  b.add("tone/Multiply", "brain.octave", {
    ...inBrain,
    name: "Octave",
    values: { factor: 2 },
  });
  // A swell every eight bars, taking seconds to rise and longer to fall.
  b.add("tone/Envelope", "brain.swell", {
    ...inBrain,
    name: "Swell",
    values: { attack: 5, decay: 3, sustain: 0.4, release: 8 },
    events: [every("8m", { duration: "4m" })],
  });
  b.add("tone/DCMeter", "brain.swellMeter", { ...inBrain, name: "Swell" });

  b.chain("brain.slowLfo", "brain.slowMeter");
  b.patch(out("brain.slowMeter"), out(brain, "slow"));
  b.patch(out("brain.gateLfo"), inp("brain.gate", "in"));
  b.chain("brain.gate", "brain.gateMeter");
  b.patch(out("brain.gateMeter"), out(brain, "gate"));
  b.chain("brain.driftLfo", "brain.driftMeter");
  b.patch(out("brain.driftMeter"), out(brain, "drift"));
  b.chain("brain.root", "brain.rootMeter");
  b.patch(out("brain.rootMeter"), out(brain, "root"));
  b.patch(out("brain.rootMeter"), inp("brain.fifth", "in"));
  b.patch(out("brain.rootMeter"), inp("brain.octave", "in"));
  b.patch(out("brain.fifth"), out(brain, "fifth"));
  b.patch(out("brain.octave"), out(brain, "octave"));
  b.chain("brain.swell", "brain.swellMeter");
  b.patch(out("brain.swellMeter"), out(brain, "swell"));

  // Drums: five voices on patterns of 16, 14, 10, 7 and 5 steps.
  const drums = b.tree("drums", "Drums", {
    inputs: ["Grit"],
    outputs: ["Mix"],
  });
  const inDrums = { parentId: drums };
  b.add("tone/MembraneSynth", "drums.kick", {
    ...inDrums,
    name: "Kick",
    values: { volume: -3, pitchDecay: 0.04, octaves: 6 },
    events: [
      seq(
        [
          "G1",
          null,
          null,
          null,
          null,
          null,
          "G1",
          null,
          null,
          null,
          "G1",
          null,
          null,
          null,
          null,
          null,
        ],
        "16n",
        { duration: "16n" },
      ),
    ],
  });
  b.add("tone/Compressor", "drums.kickComp", {
    ...inDrums,
    name: "Kick",
    values: { threshold: -16, ratio: 4, attack: 0.004, release: 0.1 },
  });
  b.add("tone/NoiseSynth", "drums.snare", {
    ...inDrums,
    name: "Snare",
    values: {
      volume: -12,
      "noise.type": "pink",
      "envelope.attack": 0.001,
      "envelope.decay": 0.18,
      "envelope.sustain": 0,
      "envelope.release": 0.1,
    },
    events: [
      seq(
        [
          null,
          null,
          null,
          null,
          1,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          1,
          null,
        ],
        "16n",
        { duration: "16n" },
      ),
    ],
  });
  b.add("tone/Filter", "drums.snareFilter", {
    ...inDrums,
    name: "Snare",
    values: { type: "bandpass", frequency: 1800, Q: 0.8 },
  });
  // Noise rather than a MetalSynth: every hit of a MetalSynth starts six
  // oscillators, and each one started is a cable the audio library checks
  // against the whole graph for loops. Hats are the busiest voice here.
  b.add("tone/NoiseSynth", "drums.hat", {
    ...inDrums,
    name: "Hat",
    values: {
      volume: -16,
      "noise.type": "white",
      "envelope.attack": 0.001,
      "envelope.decay": 0.05,
      "envelope.sustain": 0,
      "envelope.release": 0.03,
    },
    events: [
      seq([1, null, 1, 1, null, 1, null, 1, 1, null], "16n", {
        duration: "32n",
      }),
    ],
  });
  b.add("tone/Filter", "drums.hatTone", {
    ...inDrums,
    name: "Hat",
    values: { type: "highpass", frequency: 7000, Q: 0.5 },
  });
  // Its wet is the gate from Clock & Harmony: the hats turn gritty for a while,
  // then clean again.
  b.add("tone/Chebyshev", "drums.hatCrush", {
    ...inDrums,
    name: "Grit",
    values: { order: 5, wet: 0 },
  });
  b.add("tone/Panner", "drums.hatPan", {
    ...inDrums,
    name: "Hat",
    values: { pan: 0.35 },
  });
  b.add("tone/MetalSynth", "drums.ride", {
    ...inDrums,
    name: "Ride",
    values: {
      volume: -22,
      harmonicity: 3.1,
      resonance: 2500,
      octaves: 1,
      "envelope.decay": 0.5,
      "envelope.release": 0.3,
    },
    events: [
      seq([300, null, null, 300, null, 300, null], "8n", { duration: "8n" }),
    ],
  });
  b.add("tone/Panner", "drums.ridePan", {
    ...inDrums,
    name: "Ride",
    values: { pan: -0.4 },
  });
  b.add("tone/MembraneSynth", "drums.perc", {
    ...inDrums,
    name: "Perc",
    values: {
      volume: -14,
      pitchDecay: 0.01,
      octaves: 2,
      "envelope.decay": 0.08,
      "envelope.release": 0.2,
    },
    events: [seq([null, "A3", null, null, "A3"], "8n", { duration: "16n" })],
  });
  b.add("tone/PingPongDelay", "drums.percDelay", {
    ...inDrums,
    name: "Perc",
    values: { delayTime: 0.31, feedback: 0.3, wet: 0.3 },
  });
  b.add("tone/Channel", "drums.bus", { ...inDrums, name: "Drum bus" });
  b.add("tone/Compressor", "drums.glue", {
    ...inDrums,
    name: "Glue",
    values: { threshold: -14, ratio: 3, attack: 0.01, release: 0.15, knee: 20 },
  });
  b.add("tone/Meter", "drums.meter", { ...inDrums, name: "Drums" });

  b.chain("drums.kick", "drums.kickComp", "drums.bus");
  b.chain("drums.snare", "drums.snareFilter", "drums.bus");
  b.chain(
    "drums.hat",
    "drums.hatTone",
    "drums.hatCrush",
    "drums.hatPan",
    "drums.bus",
  );
  b.chain("drums.ride", "drums.ridePan", "drums.bus");
  b.chain("drums.perc", "drums.percDelay", "drums.bus");
  b.chain("drums.bus", "drums.glue", "drums.meter");
  b.patch(out("drums.meter"), out(drums, "mix"));
  b.patch(inp(drums, "grit"), mod("drums.hatCrush", "wet"));

  // Bass: a line through drive and a filter the slow clock sweeps. Its level
  // leaves as a signal, for the chords to duck under.
  const bass = b.tree("bass", "Bass", {
    inputs: ["Sweep"],
    outputs: ["Mix", "Env"],
  });
  const inBass = { parentId: bass };
  b.add("tone/MonoSynth", "bass.synth", {
    ...inBass,
    name: "Bass",
    values: {
      volume: -5,
      portamento: 0.04,
      "oscillator.type": "sawtooth",
      "envelope.attack": 0.005,
      "envelope.decay": 0.2,
      "envelope.sustain": 0.4,
      "envelope.release": 0.25,
      "filter.Q": 2,
      "filter.rolloff": -24,
      "filterEnvelope.attack": 0.01,
      "filterEnvelope.decay": 0.25,
      "filterEnvelope.sustain": 0.15,
      "filterEnvelope.release": 0.4,
      "filterEnvelope.baseFrequency": 70,
      "filterEnvelope.octaves": 3,
    },
    events: [
      seq(
        [
          "D1",
          null,
          "D1",
          null,
          null,
          "F1",
          null,
          "D1",
          null,
          null,
          "A1",
          null,
          "C2",
          null,
          "A1",
          null,
        ],
        "8n",
        { duration: "8n" },
      ),
    ],
  });
  b.add("tone/Distortion", "bass.drive", {
    ...inBass,
    name: "Drive",
    values: { distortion: 0.25, wet: 0.5 },
  });
  // Slow clock 0 to 1 onto 150 to 1200 Hz.
  b.add("tone/Scale", "bass.sweep", {
    ...inBass,
    name: "Sweep",
    values: { min: 150, max: 1200 },
  });
  b.add("tone/Filter", "bass.filter", {
    ...inBass,
    name: "Bass",
    values: { type: "lowpass", Q: 3, rolloff: -24 },
  });
  b.add("tone/Compressor", "bass.comp", {
    ...inBass,
    name: "Bass",
    values: { threshold: -12, ratio: 4, attack: 0.01, release: 0.12 },
  });
  b.add("tone/Follower", "bass.follower", {
    ...inBass,
    name: "Sidechain",
    values: { smoothing: 0.08 },
  });
  b.add("tone/Meter", "bass.meter", { ...inBass, name: "Bass" });

  b.chain("bass.synth", "bass.drive", "bass.filter", "bass.comp", "bass.meter");
  b.patch(out("bass.meter"), out(bass, "mix"));
  b.chain("bass.comp", "bass.follower");
  b.patch(out("bass.follower"), out(bass, "env"));
  b.patch(inp(bass, "sweep"), inp("bass.sweep"));
  b.patch(out("bass.sweep"), mod("bass.filter", "frequency"));

  // Chords: two synths an octave apart on the same changes, blended by the
  // slow clock so the timbre takes a minute to turn over; ducked by the bass.
  const chords = b.tree("chords", "Chords", {
    inputs: ["Morph", "Duck"],
    outputs: ["Mix"],
  });
  const inChords = { parentId: chords };
  const changes = (octave: number) => {
    const o = (note: string, up = 0) => `${note}${octave + up}`;
    return part(
      [
        ...chord("0:0", [o("D"), o("F"), o("A"), o("C", 1)]),
        ...chord("2:0", [o("Bb", -1), o("D"), o("F"), o("A")]),
        ...chord("4:0", [o("G", -1), o("Bb", -1), o("D"), o("F")]),
        ...chord("6:0", [o("A", -1), o("D"), o("E"), o("G")]),
      ],
      "8m",
      { duration: "2m" },
    );
  };
  b.add("tone/PolySynth (FMSynth)", "chords.fm", {
    ...inChords,
    name: "Glass",
    values: {
      volume: -14,
      harmonicity: 2,
      modulationIndex: 4,
      "envelope.attack": 0.4,
      "envelope.decay": 0.3,
      "envelope.sustain": 0.7,
      "envelope.release": 2.5,
      "modulationEnvelope.attack": 1,
    },
    events: [changes(3)],
  });
  b.add("tone/PolySynth (AMSynth)", "chords.am", {
    ...inChords,
    name: "Reed",
    values: {
      volume: -14,
      harmonicity: 1.5,
      "envelope.attack": 0.6,
      "envelope.release": 3,
    },
    events: [changes(4)],
  });
  b.add("tone/CrossFade", "chords.fade", { ...inChords, name: "Morph" });
  b.add("tone/Chorus", "chords.chorus", {
    ...inChords,
    name: "Chords",
    values: { frequency: 0.4, depth: 0.6, wet: 0.4 },
  });
  b.add("tone/Phaser", "chords.phaser", {
    ...inChords,
    name: "Chords",
    values: { frequency: 0.25, octaves: 2, baseFrequency: 300, wet: 0.5 },
  });
  b.add("tone/PingPongDelay", "chords.echo", {
    ...inChords,
    name: "Chords",
    values: { delayTime: 0.47, feedback: 0.35, wet: 0.3 },
  });
  b.add("tone/Multiply", "chords.duckAmount", {
    ...inChords,
    name: "Times",
    values: { factor: -1.5 },
  });
  b.add("tone/Add", "chords.duckOffset", {
    ...inChords,
    name: "Plus",
    values: { addend: 1 },
  });
  b.add("tone/Multiply", "chords.vca", { ...inChords, name: "Duck" });
  b.add("tone/StereoWidener", "chords.width", {
    ...inChords,
    name: "Chords",
    values: { width: 0.75 },
  });
  b.add("tone/FFT", "chords.fft", {
    ...inChords,
    name: "Chords",
    values: { size: 256 },
  });

  b.patch(out("chords.fm"), inp("chords.fade", "a"));
  b.patch(out("chords.am"), inp("chords.fade", "b"));
  b.chain("chords.fade", "chords.chorus", "chords.phaser", "chords.echo");
  b.patch(out("chords.echo"), inp("chords.vca", "in"));
  b.chain("chords.vca", "chords.width", "chords.fft");
  b.patch(out("chords.fft"), out(chords, "mix"));
  b.patch(inp(chords, "morph"), mod("chords.fade", "fade"));
  b.patch(inp(chords, "duck"), inp("chords.duckAmount", "in"));
  b.patch(out("chords.duckAmount"), inp("chords.duckOffset", "in"));
  b.patch(out("chords.duckOffset"), inp("chords.vca", "factor"));

  // Lead: a random walk over the scale, let through only while the gate is
  // up, with a shimmer an octave above in parallel. The drift detunes it.
  const lead = b.tree("lead", "Lead", {
    inputs: ["Drift", "Gate", "Sway"],
    outputs: ["Mix"],
  });
  const inLead = { parentId: lead };
  b.add("tone/FMSynth", "lead.synth", {
    ...inLead,
    name: "Lead",
    values: {
      volume: -12,
      portamento: 0.03,
      harmonicity: 3,
      modulationIndex: 6,
      "envelope.attack": 0.02,
      "envelope.decay": 0.3,
      "envelope.sustain": 0.2,
      "envelope.release": 0.8,
    },
    events: [
      pattern(
        ["D4", "F4", "G4", "A4", "C5", "D5", "F5"],
        "randomWalk",
        "8n",
        { duration: "16n" },
        { probability: 0.65 },
      ),
    ],
  });
  b.add("tone/Vibrato", "lead.vibrato", {
    ...inLead,
    name: "Lead",
    values: { frequency: 5.5, depth: 0.08 },
  });
  b.add("tone/PitchShift", "lead.shimmer", {
    ...inLead,
    name: "Shimmer",
    values: { pitch: 12, windowSize: 0.1 },
  });
  b.add("tone/Volume", "lead.shimmerVol", {
    ...inLead,
    name: "Shimmer",
    values: { volume: -10 },
  });
  b.add("tone/Channel", "lead.sum", { ...inLead, name: "Lead sum" });
  b.add("tone/Multiply", "lead.vca", { ...inLead, name: "Gate" });
  b.add("tone/FeedbackDelay", "lead.echo", {
    ...inLead,
    name: "Lead",
    values: { delayTime: 0.31, feedback: 0.45, wet: 0.35 },
  });
  b.add("tone/Reverb", "lead.verb", {
    ...inLead,
    name: "Lead",
    values: { decay: 3, wet: 0.3 },
  });
  b.add("tone/Filter", "lead.hp", {
    ...inLead,
    name: "Clean up",
    values: { type: "highpass", frequency: 300, Q: 0.7 },
  });
  // Slow clock 0 to 1 onto left to right, so the lead wanders across.
  b.add("tone/Scale", "lead.swayScale", {
    ...inLead,
    name: "Sway",
    values: { min: -0.7, max: 0.7 },
  });
  b.add("tone/Panner", "lead.pan", { ...inLead, name: "Lead" });
  b.add("tone/Meter", "lead.meter", { ...inLead, name: "Lead" });

  b.chain("lead.synth", "lead.vibrato", "lead.sum");
  b.chain("lead.vibrato", "lead.shimmer", "lead.shimmerVol", "lead.sum");
  b.patch(out("lead.sum"), inp("lead.vca", "in"));
  b.chain(
    "lead.vca",
    "lead.echo",
    "lead.verb",
    "lead.hp",
    "lead.pan",
    "lead.meter",
  );
  b.patch(out("lead.meter"), out(lead, "mix"));
  b.patch(inp(lead, "drift"), mod("lead.synth", "detune"));
  b.patch(inp(lead, "gate"), inp("lead.vca", "factor"));
  b.patch(inp(lead, "sway"), inp("lead.swayScale"));
  b.patch(out("lead.swayScale"), mod("lead.pan", "pan"));

  // Texture: a drone tuned by the root, fifth and octave from Clock &
  // Harmony, and noise that swells in and out with the envelope.
  const texture = b.tree("texture", "Texture", {
    inputs: ["Root", "Fifth", "Octave", "Swell"],
    outputs: ["Mix"],
  });
  const inTexture = { parentId: texture };
  b.add("tone/Oscillator", "texture.oscRoot", {
    ...inTexture,
    name: "Drone root",
    values: { volume: -18, type: "sine" },
  });
  b.add("tone/Oscillator", "texture.oscFifth", {
    ...inTexture,
    name: "Drone fifth",
    values: { volume: -22, type: "triangle" },
  });
  b.add("tone/FatOscillator", "texture.oscOctave", {
    ...inTexture,
    name: "Drone octave",
    values: { volume: -26, type: "sawtooth", count: 3, spread: 30 },
  });
  b.add("tone/Channel", "texture.droneSum", { ...inTexture, name: "Drone" });
  // Swell 0 to 1 onto 200 to 2500 Hz.
  b.add("tone/Scale", "texture.swellScale", {
    ...inTexture,
    name: "Swell",
    values: { min: 200, max: 2500 },
  });
  b.add("tone/Filter", "texture.droneFilter", {
    ...inTexture,
    name: "Drone",
    values: { type: "lowpass", Q: 1.5, rolloff: -24 },
  });
  b.add("tone/Noise", "texture.noise", {
    ...inTexture,
    name: "Air",
    values: { volume: -16, type: "pink" },
  });
  b.add("tone/AutoFilter", "texture.noiseFilter", {
    ...inTexture,
    name: "Air",
    values: { frequency: 0.05, depth: 0.8, baseFrequency: 200, octaves: 3 },
  });
  b.add("tone/FrequencyShifter", "texture.shifter", {
    ...inTexture,
    name: "Air",
    values: { frequency: 3, wet: 0.5 },
  });
  b.add("tone/AutoPanner", "texture.airPan", {
    ...inTexture,
    name: "Air",
    values: { frequency: 0.07, depth: 0.6 },
  });
  b.add("tone/Multiply", "texture.noiseVca", { ...inTexture, name: "Swell" });
  b.add("tone/Channel", "texture.sum", { ...inTexture, name: "Texture" });
  b.add("tone/Reverb", "texture.verb", {
    ...inTexture,
    name: "Texture",
    values: { decay: 6, wet: 0.5 },
  });
  b.add("tone/Tremolo", "texture.tremolo", {
    ...inTexture,
    name: "Texture",
    values: { frequency: 0.3, depth: 0.4, spread: 180 },
  });
  b.add("tone/Waveform", "texture.scope", { ...inTexture, name: "Texture" });

  b.chain("texture.oscRoot", "texture.droneSum");
  b.chain("texture.oscFifth", "texture.droneSum");
  b.chain("texture.oscOctave", "texture.droneSum");
  b.chain("texture.droneSum", "texture.droneFilter", "texture.sum");
  b.chain(
    "texture.noise",
    "texture.noiseFilter",
    "texture.shifter",
    "texture.airPan",
  );
  b.patch(out("texture.airPan"), inp("texture.noiseVca", "in"));
  b.chain(
    "texture.noiseVca",
    "texture.sum",
    "texture.verb",
    "texture.tremolo",
    "texture.scope",
  );
  b.patch(out("texture.scope"), out(texture, "mix"));
  b.patch(inp(texture, "root"), mod("texture.oscRoot", "frequency"));
  b.patch(inp(texture, "fifth"), mod("texture.oscFifth", "frequency"));
  b.patch(inp(texture, "octave"), mod("texture.oscOctave", "frequency"));
  b.patch(inp(texture, "swell"), inp("texture.swellScale"));
  b.patch(out("texture.swellScale"), mod("texture.droneFilter", "frequency"));
  b.patch(inp(texture, "swell"), inp("texture.noiseVca", "factor"));

  // Mixer: a channel and a meter per group, so it reads like a desk.
  const mixer = b.tree("mixer", "Mixer", {
    inputs: ["Drums", "Bass", "Chords", "Lead", "Texture"],
    outputs: ["Mix"],
  });
  const strips: readonly (readonly [string, number, number])[] = [
    ["drums", 0, 0],
    ["bass", -2, 0],
    ["chords", -4, -0.1],
    ["lead", -3, 0.15],
    ["texture", -6, 0],
  ];
  b.add("tone/Channel", "mixer.bus", { parentId: mixer, name: "Stereo bus" });
  b.add("tone/Meter", "mixer.busMeter", {
    parentId: mixer,
    name: "Stereo bus",
  });
  for (const [name, volume, pan] of strips) {
    const label = name[0]!.toUpperCase() + name.slice(1);
    b.add("tone/Channel", `mixer.${name}`, {
      parentId: mixer,
      name: label,
      values: { volume, pan },
    });
    b.add("tone/Meter", `mixer.${name}Meter`, { parentId: mixer, name: label });
    b.patch(inp(mixer, name), inp(`mixer.${name}`));
    b.chain(`mixer.${name}`, `mixer.${name}Meter`, "mixer.bus");
  }
  b.chain("mixer.bus", "mixer.busMeter");
  b.patch(out("mixer.busMeter"), out(mixer, "mix"));

  // Master: glue, tone, space, a limiter, and two readouts. Nothing here fans
  // out: every note's cable is checked against every path to the speakers, so
  // a master that split into bands made each note cost many times more.
  const master = b.tree("master", "Master", {
    inputs: ["Mix"],
    outputs: ["Mix"],
  });
  const inMaster = { parentId: master };
  b.add("tone/Compressor", "master.comp", {
    ...inMaster,
    name: "Glue",
    values: {
      threshold: -16,
      ratio: 2.5,
      attack: 0.02,
      release: 0.25,
      knee: 20,
    },
  });
  b.add("tone/EQ3", "master.eq", {
    ...inMaster,
    name: "Tone",
    values: { low: 1, mid: -1, high: 1.5 },
  });
  b.add("tone/Reverb", "master.glue", {
    ...inMaster,
    name: "Room",
    values: { decay: 2, wet: 0.12 },
  });
  b.add("tone/Limiter", "master.limiter", {
    ...inMaster,
    name: "Safety",
    values: { threshold: -2 },
  });
  b.add("tone/FFT", "master.fft", {
    ...inMaster,
    name: "Master",
    values: { size: 512 },
  });
  b.add("tone/Waveform", "master.scope", { ...inMaster, name: "Master" });

  b.patch(inp(master, "mix"), inp("master.comp"));
  b.chain(
    "master.comp",
    "master.eq",
    "master.glue",
    "master.limiter",
    "master.fft",
    "master.scope",
  );
  b.patch(out("master.scope"), out(master, "mix"));

  b.add("tone/Destination", "out");

  // The control signals reach the groups that follow them.
  b.patch(out(brain, "slow"), inp(chords, "morph"));
  b.patch(out(brain, "slow"), inp(bass, "sweep"));
  b.patch(out(brain, "slow"), inp(lead, "sway"));
  b.patch(out(brain, "gate"), inp(drums, "grit"));
  b.patch(out(brain, "gate"), inp(lead, "gate"));
  b.patch(out(brain, "drift"), inp(lead, "drift"));
  b.patch(out(brain, "root"), inp(texture, "root"));
  b.patch(out(brain, "fifth"), inp(texture, "fifth"));
  b.patch(out(brain, "octave"), inp(texture, "octave"));
  b.patch(out(brain, "swell"), inp(texture, "swell"));
  b.patch(out(bass, "env"), inp(chords, "duck"));

  // And the audio reaches the desk.
  for (const [name] of strips) b.patch(out(name, "mix"), inp(mixer, name));
  b.patch(out(mixer, "mix"), inp(master, "mix"));
  b.patch(out(master, "mix"), inp("out"));

  return b.build();
};
