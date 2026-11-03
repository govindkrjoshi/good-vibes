import { beforeAll, expect, test } from "vitest";
import type * as ToneJs from "tone";
import { tonePlugin } from ".";
import { diffRack, emptyRackState } from "../../../rack/diff";
import { createRenderer } from "../../../rack/renderer";
import { loadRealTone } from "../../../testing/real-tone";
import { instantiate } from "../../instantiate";

let tone: typeof ToneJs;
beforeAll(async () => {
  tone = await loadRealTone();
});

// Builds each item as the sandbox would, with every param set to its default,
// and reports what Tone refused.
const build = (item: (typeof tonePlugin.items)[number]) => {
  const errors: string[] = [];
  const renderer = createRenderer({ tone, report: (m) => errors.push(m) });
  const placed = instantiate(item, "R");
  renderer.apply(
    diffRack(emptyRackState, {
      ...emptyRackState,
      racks: { R: placed.rack },
      jacks: placed.jacks,
      paramGroups: { [placed.paramGroup.id]: placed.paramGroup },
      values: placed.values,
      methods: placed.methods,
    }),
  );
  renderer.reset();
  return errors;
};

test.each(tonePlugin.items.map((item) => [item.name, item] as const))(
  "%s builds with real Tone and takes every param",
  (_, item) => {
    expect(build(item)).toEqual([]);
  },
);
