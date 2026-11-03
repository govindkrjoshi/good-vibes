import {
  defineItem,
  detune,
  envelopeGroup,
  filterEnvelopeGroup,
  filterGroup,
  monophonic,
  numberParam,
  oscillatorGroup,
  portamento,
  riff,
  toneCode,
  volume,
} from "../../../kit";
import type { ParamSpecGroup } from "../../../spec";

type Stages = Partial<
  Record<"attack" | "decay" | "sustain" | "release", number>
>;

const exponent = numberParam({
  name: "Exponent",
  path: ["exponent"],
  defaultValue: 2,
  min: 1,
  max: 10,
  step: 0.1,
});

// A MonoSynth's sections under `path`, so DuoSynth can give each of its two
// voices the same controls.
export const voiceGroups = (
  path: readonly string[],
  {
    envelope,
    filterEnvelope,
  }: { readonly envelope?: Stages; readonly filterEnvelope?: Stages } = {},
): Record<string, ParamSpecGroup> => {
  const filter = filterGroup([...path, "filter"]);
  const sweep = filterEnvelopeGroup(
    [...path, "filterEnvelope"],
    filterEnvelope,
  );
  return {
    oscillator: oscillatorGroup([...path, "oscillator"], { type: "sawtooth" }),
    envelope: envelopeGroup([...path, "envelope"], envelope),
    // The filter envelope drives the cutoff, so it has no knob of its own.
    filter: {
      ...filter,
      params: filter.params?.filter((param) => param.name !== "Cutoff"),
    },
    filterEnvelope: {
      ...sweep,
      params: [
        ...(sweep.params ?? []),
        exponent({ path: [...path, "filterEnvelope", "exponent"] }),
      ],
    },
  };
};

// Exported so PolySynth can play MonoSynth voices with the same controls.
export const params: ParamSpecGroup = {
  params: [volume(), detune({ patchable: true }), portamento()],
  groups: voiceGroups([], {
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.9, release: 1 },
    filterEnvelope: { attack: 0.6, decay: 0.2, sustain: 0.5, release: 2 },
  }),
};

export default defineItem("instruments", "MonoSynth", {
  description:
    "An oscillator through a filter swept by its own envelope, then an amplitude envelope, for classic subtractive bass and lead sounds.",
  code: toneCode("new tone.MonoSynth()"),
  params,
  methods: monophonic(),
  events: [riff("C2", "C3")],
});
