import {
  automatable,
  defineItem,
  detune,
  harmonicity,
  monophonic,
  numberParam,
  portamento,
  riff,
  toneCode,
  volume,
} from "../../../kit";
import type { ParamSpecGroup } from "../../../spec";
import { voiceGroups } from "./mono_synth";

const vibratoAmount = numberParam({
  name: "Vibrato Amount",
  path: ["vibratoAmount"],
  defaultValue: 0.5,
  min: 0,
  max: 1,
  step: 0.01,
  automation: automatable,
});

const vibratoRate = numberParam({
  name: "Vibrato Rate",
  path: ["vibratoRate"],
  defaultValue: 5,
  min: 0,
  max: 20,
  step: 0.1,
  unit: "Hz",
  automation: automatable,
});

const stages = { attack: 0.01, decay: 0, sustain: 1, release: 0.5 };

const voice = (key: string, name: string): ParamSpecGroup => ({
  name,
  groups: voiceGroups([key], { envelope: stages, filterEnvelope: stages }),
});

// Exported so PolySynth can play DuoSynth voices with the same controls.
export const params: ParamSpecGroup = {
  params: [
    volume(),
    detune({ patchable: true }),
    portamento(),
    // The second voice plays at this ratio of the first's frequency.
    harmonicity({ defaultValue: 1.5 }),
    vibratoAmount(),
    vibratoRate(),
  ],
  groups: {
    voice0: voice("voice0", "Voice 1"),
    voice1: voice("voice1", "Voice 2"),
  },
};

export default defineItem("instruments", "DuoSynth", {
  description:
    "Two MonoSynth voices played together, the second at a ratio of the first's pitch, with shared vibrato for thick, detuned leads.",
  code: toneCode("new tone.DuoSynth()"),
  params,
  methods: monophonic(),
  events: [riff()],
});
