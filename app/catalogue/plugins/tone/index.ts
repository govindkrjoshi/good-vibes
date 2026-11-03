import type { ItemSpec, PluginSpec } from "../../spec";

// Each file under a category folder default-exports an item, or an array of
// items made from one definition.
const files = import.meta.glob<{ default: ItemSpec | ItemSpec[] }>(
  ["./*/*.ts", "!./**/*.test.ts"],
  { eager: true },
);

export const tonePlugin: PluginSpec = {
  format: 1,
  id: "tone",
  name: "Tone.js",
  version: "15.1.22",
  description: "The instruments, sources, effects and components of Tone.js.",
  items: Object.keys(files)
    .sort()
    .flatMap((path) => files[path]?.default ?? []),
};
