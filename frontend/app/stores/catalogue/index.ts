import { Effect } from "effect";
import { Tone } from "../../audio-renderer";
import { type RackTemplate } from "../../types/rack";

export type CatalogueEntry = {
  readonly name: string;
  readonly rack: RackTemplate;
};

export type Catalogue = Readonly<
  Record<string, Readonly<Record<string, CatalogueEntry>>>
>;

const amOscillatorRack: RackTemplate = {
  id: "catalogue:source:AMOscillator",
  name: "AMOscillator",
  type: "leaf",
  isRoot: false,
  jackIds: [],
  params: {},
  code: () =>
    Effect.gen(function* () {
      const tone = yield* Tone;
      // An oscillator makes no sound until started, and has no trigger
      // method to start it later, so it runs from the moment it is built.
      return new tone.AMOscillator().start();
    }),
};

const amSynthRack: RackTemplate = {
  id: "catalogue:instruments:AMSynth",
  name: "AMSynth",
  type: "leaf",
  isRoot: false,
  jackIds: [],
  params: {
    params: {
      volume: {
        name: "Volume",
        kind: "number",
        path: ["volume"],
        defaultValue: 0,
        min: -60,
        max: 12,
        step: 1,
        unit: "dB",
        automation: {
          methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
        },
      },
      detune: {
        name: "Detune",
        kind: "number",
        path: ["detune"],
        defaultValue: 0,
        min: -1200,
        max: 1200,
        step: 1,
        unit: "cents",
        automation: {
          methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
        },
      },
      portamento: {
        name: "Portamento",
        kind: "number",
        path: ["portamento"],
        defaultValue: 0,
        min: 0,
        step: 0.01,
        unit: "s",
      },
      harmonicity: {
        name: "Harmonicity",
        kind: "number",
        path: ["harmonicity"],
        defaultValue: 3,
        min: 0,
        max: 16,
        step: 0.01,
        automation: {
          methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
        },
      },
    },
    groups: {
      oscillator: {
        name: "Oscillator",
        params: {
          type: {
            name: "Type",
            kind: "select",
            path: ["oscillator", "type"],
            defaultValue: "sine",
            options: [
              { value: "sine" },
              { value: "square" },
              { value: "triangle" },
              { value: "sawtooth" },
              { value: "pulse" },
              { value: "pwm" },
              { value: "fatsine" },
              { value: "fmsine" },
              { value: "amsine" },
            ],
          },
          detune: {
            name: "Oscillator Detune",
            kind: "number",
            path: ["oscillator", "detune"],
            defaultValue: 0,
            min: -1200,
            max: 1200,
            step: 1,
            unit: "cents",
            automation: {
              methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
            },
          },
          width: {
            name: "Pulse Width",
            kind: "number",
            path: ["oscillator", "width"],
            defaultValue: 0.5,
            min: 0,
            max: 1,
            step: 0.01,
            automation: {
              methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
            },
          },
          modulationFrequency: {
            name: "PWM Frequency",
            kind: "number",
            path: ["oscillator", "modulationFrequency"],
            defaultValue: 0.4,
            min: 0,
            step: 0.01,
            unit: "Hz",
            automation: {
              methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
            },
          },
        },
      },
      envelope: {
        name: "Envelope",
        params: {
          attack: {
            name: "Attack",
            kind: "number",
            path: ["envelope", "attack"],
            defaultValue: 0.01,
            min: 0,
            step: 0.01,
            unit: "s",
          },
          decay: {
            name: "Decay",
            kind: "number",
            path: ["envelope", "decay"],
            defaultValue: 0.01,
            min: 0,
            step: 0.01,
            unit: "s",
          },
          sustain: {
            name: "Sustain",
            kind: "number",
            path: ["envelope", "sustain"],
            defaultValue: 1,
            min: 0,
            max: 1,
            step: 0.01,
          },
          release: {
            name: "Release",
            kind: "number",
            path: ["envelope", "release"],
            defaultValue: 0.5,
            min: 0,
            step: 0.01,
            unit: "s",
          },
        },
      },
      modulation: {
        name: "Modulation",
        params: {
          type: {
            name: "Type",
            kind: "select",
            path: ["modulation", "type"],
            defaultValue: "square",
            options: [
              { value: "sine" },
              { value: "square" },
              { value: "triangle" },
              { value: "sawtooth" },
            ],
          },
          detune: {
            name: "Modulation Detune",
            kind: "number",
            path: ["modulation", "detune"],
            defaultValue: 0,
            min: -1200,
            max: 1200,
            step: 1,
            unit: "cents",
            automation: {
              methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"],
            },
          },
        },
      },
      modulationEnvelope: {
        name: "Modulation Envelope",
        params: {
          attack: {
            name: "Attack",
            kind: "number",
            path: ["modulationEnvelope", "attack"],
            defaultValue: 0.5,
            min: 0,
            step: 0.01,
            unit: "s",
          },
          decay: {
            name: "Decay",
            kind: "number",
            path: ["modulationEnvelope", "decay"],
            defaultValue: 0,
            min: 0,
            step: 0.01,
            unit: "s",
          },
          sustain: {
            name: "Sustain",
            kind: "number",
            path: ["modulationEnvelope", "sustain"],
            defaultValue: 1,
            min: 0,
            max: 1,
            step: 0.01,
          },
          release: {
            name: "Release",
            kind: "number",
            path: ["modulationEnvelope", "release"],
            defaultValue: 0.5,
            min: 0,
            step: 0.01,
            unit: "s",
          },
        },
      },
    },
  },
  methods: {
    triggerAttack: {
      name: "Trigger Attack",
      method: "triggerAttack",
      args: [
        { name: "note", kind: "note" },
        { name: "time", kind: "time", optional: true },
        { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
      ],
    },
    triggerRelease: {
      name: "Trigger Release",
      method: "triggerRelease",
      args: [{ name: "time", kind: "time", optional: true }],
    },
    triggerAttackRelease: {
      name: "Trigger Attack Release",
      method: "triggerAttackRelease",
      args: [
        { name: "note", kind: "note" },
        { name: "duration", kind: "time" },
        { name: "time", kind: "time", optional: true },
        { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
      ],
    },
    setNote: {
      name: "Set Note",
      method: "setNote",
      args: [
        { name: "note", kind: "note" },
        { name: "time", kind: "time", optional: true },
      ],
    },
  },
  code: () =>
    Effect.gen(function* () {
      const tone = yield* Tone;
      return new tone.AMSynth();
    }),
};

// The speakers. Anything patched into it is sent to Tone's destination.
const destinationRack: RackTemplate = {
  id: "catalogue:output:Destination",
  name: "Destination",
  type: "leaf",
  isRoot: false,
  jackIds: [],
  jacks: ["in"],
  params: {},
  code: () =>
    Effect.gen(function* () {
      const tone = yield* Tone;
      return tone.getDestination();
    }),
};

export const CATALOGUE: Catalogue = {
  source: {
    AMOscillator: {
      name: "AMOscillator",
      rack: amOscillatorRack,
    },
  },
  instruments: {
    AMSynth: {
      name: "AMSynth",
      rack: amSynthRack,
    },
  },
  output: {
    Destination: {
      name: "Destination",
      rack: destinationRack,
    },
  },
};
