import {
  attack,
  automatable,
  defineItem,
  knee,
  ratio,
  release,
  threshold,
  toneCode,
} from "../../../kit";
import type { ParamSpec, ParamSpecGroup } from "../../../spec";

type Settings = Record<
  "threshold" | "ratio" | "attack" | "release" | "knee",
  number
>;

// The Web Audio compressor's controls under `path`, with its ranges.
export const compressorParams = (
  path: readonly string[],
  settings: Settings,
): ParamSpec[] => {
  const at = (key: keyof Settings) => ({
    path: [...path, key],
    defaultValue: settings[key],
  });
  return [
    threshold(at("threshold")),
    ratio(at("ratio")),
    attack({ ...at("attack"), max: 1, step: 0.001, automation: automatable }),
    release({ ...at("release"), max: 1, automation: automatable }),
    knee(at("knee")),
  ];
};

export const compressorGroup = (
  path: readonly string[],
  name: string,
  settings: Settings,
): ParamSpecGroup => ({ name, params: compressorParams(path, settings) });

export default defineItem("components", "Compressor", {
  description:
    "A compressor that turns down whatever rises above its threshold, evening out loud and quiet parts.",
  code: toneCode("new tone.Compressor()"),
  params: {
    params: compressorParams([], {
      threshold: -24,
      ratio: 12,
      attack: 0.003,
      release: 0.25,
      knee: 30,
    }),
  },
});
