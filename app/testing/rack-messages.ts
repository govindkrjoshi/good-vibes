import { CATALOGUE } from "../catalogue";
import type { RackMsg } from "../rack/messages";
import type { RackState, RackTemplate } from "../rack/model";

// Random rack messages for tests that check a property over many sequences.

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

// A small seeded generator, so a failing run can be repeated from its seed.
export const random = (seed: number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const templates = [
  template("instruments", "AMSynth"),
  template("output", "Destination"),
];

export const randomMsg = (state: RackState, rand: () => number): RackMsg => {
  const pick = <T>(items: readonly T[], fallback: T): T =>
    items.length === 0
      ? fallback
      : (items[Math.floor(rand() * items.length)] ?? fallback);
  const blockIds = Object.keys(state.blocks);
  const jackIds = Object.keys(state.jacks);
  const paramIds = Object.keys(state.params);
  const eventIds = Object.keys(state.events);
  const methodIds = Object.keys(state.methods);
  const id = `id-${Math.floor(rand() * 6)}`;

  // Weighted towards building and wiring, so a sequence gets far enough to
  // have working patches as well as broken ones.
  const kinds = [0, 1, 1, 1, 2, 2, 2, 3, 4, 5, 5, 6, 7, 8, 9, 10];
  switch (pick(kinds, 0)) {
    case 0:
      return { _tag: "AddBlock", blockId: id, blockType: "leaf" };
    case 1:
      return {
        _tag: "AddTemplate",
        blockId: id,
        template: pick(templates, templates[0] as RackTemplate),
      };
    case 2: {
      // Mostly an output into an input, which can make a patch; sometimes
      // any two jacks, which mostly cannot.
      const of = (direction: "in" | "out") =>
        jackIds.filter((jack) => state.jacks[jack]?.direction === direction);
      const sensible = rand() < 0.8;
      return {
        _tag: "ConnectJacks",
        patchId: id,
        from: pick(sensible ? of("out") : jackIds, "x"),
        to: pick(sensible ? of("in") : jackIds, "y"),
      };
    }
    case 3:
      return { _tag: "RemoveBlocks", blockIds: [pick(blockIds, "x")] };
    case 4:
      return {
        _tag: "RemovePatches",
        patchIds: [pick(Object.keys(state.patches), "x")],
      };
    case 5:
      return {
        _tag: "SetParamValue",
        paramId: pick(paramIds, "x"),
        value: pick([-6, 0, 1, 1e9, "sine", true], 0),
      };
    case 6:
      return {
        _tag: "AddAutomation",
        paramId: pick(paramIds, "x"),
        automationId: id,
        event: { method: "setValueAtTime", value: rand(), time: "0" },
      };
    case 7:
      return {
        _tag: "AddEvent",
        eventId: id,
        methodId: pick(methodIds, "x"),
        settings: {
          kind: "sequence",
          args: { duration: "8n" },
          mute: false,
          steps: ["C4"],
          subdivision: "8n",
        },
      };
    case 8:
      return { _tag: "RemoveEvent", eventId: pick(eventIds, "x") };
    case 9:
      return { _tag: "SetTransport", bpm: pick([0, 60, 120, -1], 120) };
    default:
      return { _tag: "PlayEvent", eventId: pick(eventIds, "x") };
  }
};
