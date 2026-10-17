import { Effect } from "effect";
import {
  RenderContext,
  type ParamGroup,
  type Method,
  type RackEvent,
  type Jack,
} from "../../rack/model";
import {
  attack,
  decay,
  detune,
  harmonicity,
  inputJack,
  modulationFrequency,
  oscillatorType,
  outputJack,
  portamento,
  pulseWidth,
  release,
  sequence,
  setNote,
  sustain,
  triggerAttack,
  triggerAttackRelease,
  triggerRelease,
  volume,
  byId,
  type CatalogueItem,
} from "../common";

const name: string = "AMSynth";
const category: string = "instruments";
const type = "leaf";
const id: string = `catalogue:${category}:${name}`;

const paramGroup: ParamGroup = {
  id: `${id}:paramGroup`,
  params: [volume(id), detune(id), portamento(id), harmonicity(id)],
  groups: {
    oscillator: {
      id: `${id}:paramGroup:oscillator`,
      name: "Oscillator",
      params: [
        oscillatorType(id, {
          path: ["oscillator", "type"],
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
        }),
        detune(id, {
          name: "Oscillator Detune",
          path: ["oscillator", "detune"],
        }),
        pulseWidth(id, { path: ["oscillator", "width"] }),
        modulationFrequency(id, {
          path: ["oscillator", "modulationFrequency"],
        }),
      ],
    },
    envelope: {
      id: `${id}:paramGroup:envelope`,
      name: "Envelope",
      params: [
        attack(id, { path: ["envelope", "attack"] }),
        decay(id, { path: ["envelope", "decay"], defaultValue: 0.01 }),
        sustain(id, { path: ["envelope", "sustain"] }),
        release(id, { path: ["envelope", "release"] }),
      ],
    },
    modulation: {
      id: `${id}:paramGroup:modulation`,
      name: "Modulation",
      params: [
        oscillatorType(id, {
          path: ["modulation", "type"],
          defaultValue: "square",
        }),
        detune(id, {
          name: "Modulation Detune",
          path: ["modulation", "detune"],
        }),
      ],
    },
    modulationEnvelope: {
      id: `${id}:paramGroup:modulationEnvelope`,
      name: "Modulation Envelope",
      params: [
        attack(id, {
          path: ["modulationEnvelope", "attack"],
          defaultValue: 0.5,
        }),
        decay(id, { path: ["modulationEnvelope", "decay"], defaultValue: 0 }),
        sustain(id, { path: ["modulationEnvelope", "sustain"] }),
        release(id, { path: ["modulationEnvelope", "release"] }),
      ],
    },
  },
};

const jacks: Jack[] = [inputJack(id), outputJack(id)];

const methods: Method[] = [
  triggerAttack(id),
  triggerRelease(id),
  triggerAttackRelease(id),
  setNote(id),
];

// A synth that is silent until scheduled is hard to tell from one that is
// broken, so it arrives playing a riff, with rests so the hits stand apart.
const events: RackEvent[] = [
  sequence(id, "riff", triggerAttackRelease(id).id, {
    steps: ["C3", null, "E3", null, "G3", null, "C4", null],
    args: { duration: "16n" },
  }),
];

export const item: CatalogueItem = {
  name,
  category,
  rack: {
    id,
    name,
    type,
    paramGroupId: paramGroup.id,
    jackIds: jacks.map((i) => i.id),
    eventIds: events.map((i) => i.id),
    methodIds: methods.map((i) => i.id),
    isRoot: false,
    code: Effect.gen(function* () {
      const { tone } = yield* RenderContext;
      return new tone.AMSynth();
    }),
  },
  paramGroup: paramGroup,
  methods: byId(methods),
  events: byId(events),
  jacks: byId(jacks),
};
