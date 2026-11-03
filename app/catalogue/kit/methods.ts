import type { EventSpec, MethodSpec } from "../spec";

type Overrides = Partial<Omit<MethodSpec, "method">>;

// A method's defaults, overridable when an item's Tone class takes other args.
const method =
  (defaults: MethodSpec) =>
  (overrides: Overrides = {}): MethodSpec => ({ ...defaults, ...overrides });

export const triggerAttack = method({
  name: "Trigger Attack",
  method: "triggerAttack",
  args: [
    { name: "note", kind: "note" },
    { name: "time", kind: "time", optional: true },
    { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
  ],
});

export const triggerRelease = method({
  name: "Trigger Release",
  method: "triggerRelease",
  args: [{ name: "time", kind: "time", optional: true }],
});

export const triggerAttackRelease = method({
  name: "Trigger Attack Release",
  method: "triggerAttackRelease",
  args: [
    { name: "note", kind: "note" },
    { name: "duration", kind: "time" },
    { name: "time", kind: "time", optional: true },
    { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
  ],
});

export const setNote = method({
  name: "Set Note",
  method: "setNote",
  args: [
    { name: "note", kind: "note" },
    { name: "time", kind: "time", optional: true },
  ],
});

// What a monophonic Tone instrument can be played with.
export const monophonic = () => [
  triggerAttack(),
  triggerRelease(),
  triggerAttackRelease(),
  setNote(),
];

// The triggers of something with no pitch, like a noise burst or an
// envelope: a step that isn't a rest is a hit.
export const unpitched = () => [
  triggerAttack({
    args: [
      { name: "time", kind: "time", optional: true },
      { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
    ],
  }),
  triggerRelease(),
  triggerAttackRelease({
    args: [
      { name: "duration", kind: "time" },
      { name: "time", kind: "time", optional: true },
      { name: "velocity", kind: "number", optional: true, defaultValue: 1 },
    ],
  }),
];

type SequenceEvent = Extract<EventSpec, { kind: "sequence" }>;

// A sequence calling `method`, a Tone method name the item has.
export const sequence = (
  method: string,
  overrides: Partial<Omit<SequenceEvent, "kind" | "method">> = {},
): EventSpec => ({
  kind: "sequence",
  method,
  steps: [],
  subdivision: "8n",
  args: {},
  mute: false,
  ...overrides,
});

// A synth that is silent until scheduled is hard to tell from one that is
// broken, so pitched instruments arrive playing a riff, with rests so the
// hits stand apart.
export const riff = (low = "C3", high = "C4") =>
  sequence("triggerAttackRelease", {
    steps: [low, null, "E3", null, "G3", null, high, null],
    args: { duration: "16n" },
  });

// A beat for drum-like instruments, on quarter notes.
export const pulse = (note: string | number = "C2") =>
  sequence("triggerAttackRelease", {
    steps: [note, null, note, null],
    subdivision: "8n",
    args: { duration: "16n" },
  });
