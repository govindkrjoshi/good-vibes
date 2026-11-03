import type { Registry } from "../catalogue/registry";
import type { RackState } from "../rack/model";
import { dubPulse } from "./dub-pulse";
import { furElise } from "./fur-elise";
import { generativeSession } from "./generative-session";
import { sidechainGarden } from "./sidechain-garden";

// A rack built to show what the graph can do, at a size.
export type Demo = {
  readonly id: string;
  readonly name: string;
  // One line on what it shows.
  readonly tagline: string;
  readonly build: (registry: Registry) => RackState;
};

export const demos: readonly Demo[] = [
  {
    id: "dub-pulse",
    name: "Dub Pulse",
    tagline: "One bass line, a swept filter and an echo you can push too far.",
    build: dubPulse,
  },
  {
    id: "sidechain-garden",
    name: "Sidechain Garden",
    tagline: "A kick that ducks and darkens a pad, with a mid/side master.",
    build: sidechainGarden,
  },
  {
    id: "fur-elise",
    name: "Für Elise",
    tagline:
      "Beethoven for a small orchestra, read from one score, a minute a pass.",
    build: furElise,
  },
  {
    id: "generative-session",
    name: "Generative Session",
    tagline: "Eight groups on shared clocks that play themselves for hours.",
    build: generativeSession,
  },
];

// How many racks a state holds, not counting the root.
export const rackCount = (state: RackState) =>
  Object.keys(state.racks).length - 1;
