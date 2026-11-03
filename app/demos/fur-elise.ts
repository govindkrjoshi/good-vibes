import type { Registry } from "../catalogue/registry";
import type { RackState } from "../rack/model";
import { DemoBuilder, inp, out, part, type DemoEvent } from "./builder";

// Für Elise, the opening section with both repeats, scored for a small
// orchestra: a minute and a bit of Beethoven before it comes round again. The
// score is written below as bars; every rack's Parts are read off it, so the
// flute, oboe, harp, cello, bass, strings, horns and timpani all play from
// the same text. Each section brings another group in.

// A bar is 3/8, six sixteenths. A hand is six tokens: a note, `_` to hold
// the last note on, or `r` for a rest. The chord and the root are what the
// strings and the bass make of the bar.
type Bar = {
  readonly rh: string;
  readonly lh: string;
  readonly chord?: readonly string[];
  readonly root?: string;
};

const Am = ["A3", "C4", "E4"];
const E7 = ["G#3", "B3", "D4"];
const C = ["G3", "C4", "E4"];
const G7 = ["G3", "B3", "F4"];

const bars: Readonly<Record<string, Bar>> = {
  // The pickup.
  P: { rh: "r r r r E5 D#5", lh: "r r r r r r" },
  1: { rh: "E5 D#5 E5 B4 D5 C5", lh: "r r r r r r" },
  2: { rh: "A4 _ r C4 E4 A4", lh: "A2 E3 A3 r r r", chord: Am, root: "A1" },
  3: { rh: "B4 _ r E4 G#4 B4", lh: "E2 E3 G#3 r r r", chord: E7, root: "E1" },
  4: { rh: "C5 _ r E4 E5 D#5", lh: "A2 E3 A3 r r r", chord: Am, root: "A1" },
  7: { rh: "B4 _ r E4 C5 B4", lh: "E2 E3 G#3 r r r", chord: E7, root: "E1" },
  // The first ending turns back; the second leads on.
  "8a": { rh: "A4 _ r E4 E5 D#5", lh: "A2 E3 A3 r r r", chord: Am, root: "A1" },
  "8b": { rh: "A4 _ r B4 C5 D5", lh: "A2 E3 A3 r r r", chord: Am, root: "A1" },
  9: { rh: "E5 _ r G4 F5 E5", lh: "C3 G3 C4 r r r", chord: C, root: "C2" },
  10: { rh: "D5 _ r F4 E5 D5", lh: "G2 G3 B3 r r r", chord: G7, root: "G1" },
  11: { rh: "C5 _ r E4 D5 C5", lh: "A2 E3 A3 r r r", chord: Am, root: "A1" },
  12: { rh: "B4 _ r E4 E5 E5", lh: "E2 E3 r r r r", chord: E7, root: "E1" },
  13: { rh: "E6 D#5 E5 D#5 E5 D#5", lh: "r r r r r r", chord: E7 },
  14: { rh: "E5 D#5 E5 D#5 E5 D#5", lh: "r r r r r r", chord: E7 },
  // The close, and a bar for the hall to ring.
  22: { rh: "A4 _ _ _ _ _", lh: "A2 E3 A3 r r r", chord: Am, root: "A1" },
  T: { rh: "r r r r r r", lh: "r r r r r r" },
};

// Bars 5, 6, 15, 16, 19 and 20 repeat 1 and 2; 17, 18 and 21 repeat 3, 4 and 7.
const theme = ["1", "2", "3", "4", "1", "2", "7"];
const episode = ["9", "10", "11", "12", "13", "14", ...theme];

type Section = "A1" | "A2" | "B1" | "B2" | "T";

// The whole score in order, each bar under the section that decides who plays.
const score: readonly (readonly [Section, string])[] = [
  ["A1", "P"],
  ...theme.map((bar): [Section, string] => ["A1", bar]),
  ["A1", "8a"],
  ...theme.map((bar): [Section, string] => ["A2", bar]),
  ["A2", "8b"],
  ...episode.map((bar): [Section, string] => ["B1", bar]),
  ["B1", "8b"],
  ...episode.map((bar): [Section, string] => ["B2", bar]),
  ["B2", "22"],
  ["T", "T"],
];

const slotsPerBar = 6;
const sixteenths = (count: number) => `0:0:${count}`;
const loopEnd = sixteenths(score.length * slotsPerBar);

type Note = { readonly slot: number; readonly note: string; length: number };

// A hand's notes in a bar, each as long as the holds after it.
const hand = (bar: Bar, which: "rh" | "lh", at: number): Note[] => {
  const notes: Note[] = [];
  bar[which].split(" ").forEach((token, index) => {
    if (token === "_") notes.at(-1)!.length += 1;
    else if (token !== "r")
      notes.push({ slot: at + index, note: token, length: 1 });
  });
  return notes;
};

const up = (note: string, octaves: number) =>
  note.replace(/\d+$/, (octave) => String(Number(octave) + octaves));

const held = (notes: readonly string[] | undefined, at: number): Note[] =>
  (notes ?? []).map((note) => ({ slot: at, note, length: slotsPerBar }));

// Ties a note to the same note starting as it ends, so a chord held over two
// bars is one long note rather than two, and the voices are not spent twice.
const tied = (notes: readonly Note[]): Note[] => {
  const sorted = [...notes].sort((a, b) => a.slot - b.slot);
  const kept: Note[] = [];
  for (const note of sorted) {
    const before = kept.find(
      (held) =>
        held.note === note.note && held.slot + held.length === note.slot,
    );
    if (before === undefined) kept.push({ ...note });
    else before.length += note.length;
  }
  return kept;
};

// What a rack plays: a bar's notes, for the bars in its sections.
const lines = (
  sections: readonly Section[],
  pick: (bar: Bar, at: number, key: string) => Note[],
): Note[] =>
  score.flatMap(([section, key], index) =>
    sections.includes(section)
      ? pick(bars[key]!, index * slotsPerBar, key)
      : [],
  );

// A Part per note length, since a Part's duration is one setting.
const parts = (
  notes: readonly Note[],
  extra: Readonly<Record<string, number>> = {},
): DemoEvent[] => {
  const byLength = new Map<number, [string, string][]>();
  for (const { slot, note, length } of notes) {
    const steps = byLength.get(length) ?? [];
    steps.push([sixteenths(slot), note]);
    byLength.set(length, steps);
  }
  return [...byLength].map(([length, steps]) =>
    part(steps, loopEnd, { duration: sixteenths(length), ...extra }),
  );
};

const all: readonly Section[] = ["A1", "A2", "B1", "B2"];
const fromSecond: readonly Section[] = ["A2", "B1", "B2"];
const episodes: readonly Section[] = ["B1", "B2"];

export const furElise = (registry: Registry): RackState => {
  const b = new DemoBuilder(registry, 64);

  // Winds: the flute carries the tune throughout; the oboe doubles it, a
  // touch sharp, for the last time through.
  const winds = b.tree("winds", "Winds", { outputs: ["Mix"] });
  const inWinds = { parentId: winds };
  b.add("tone/Synth", "winds.flute", {
    ...inWinds,
    name: "Flute",
    values: {
      volume: -10,
      "oscillator.type": "triangle",
      "envelope.attack": 0.03,
      "envelope.decay": 0.1,
      "envelope.sustain": 0.8,
      "envelope.release": 0.12,
    },
    events: parts(lines(all, (bar, at) => hand(bar, "rh", at))),
  });
  b.add("tone/Vibrato", "winds.fluteVibrato", {
    ...inWinds,
    name: "Flute",
    values: { frequency: 5, depth: 0.05 },
  });
  b.add("tone/Synth", "winds.oboe", {
    ...inWinds,
    name: "Oboe",
    values: {
      volume: -18,
      detune: 7,
      "oscillator.type": "sawtooth",
      "envelope.attack": 0.05,
      "envelope.decay": 0.1,
      "envelope.sustain": 0.7,
      "envelope.release": 0.15,
    },
    events: parts(lines(["B2"], (bar, at) => hand(bar, "rh", at))),
  });
  b.add("tone/Filter", "winds.oboeReed", {
    ...inWinds,
    name: "Oboe",
    values: { type: "lowpass", frequency: 1600, Q: 2.5, rolloff: -24 },
  });
  b.add("tone/Channel", "winds.bus", {
    ...inWinds,
    name: "Winds",
    values: { pan: 0.15 },
  });
  b.chain("winds.flute", "winds.fluteVibrato", "winds.bus");
  b.chain("winds.oboe", "winds.oboeReed", "winds.bus");
  b.patch(out("winds.bus"), out(winds, "mix"));

  // Harp: the left hand's arpeggios an octave up, ringing, from the start.
  const harp = b.tree("harp", "Harp", { outputs: ["Mix"] });
  const inHarp = { parentId: harp };
  b.add("tone/PolySynth (Synth)", "harp.harp", {
    ...inHarp,
    name: "Harp",
    values: {
      volume: -14,
      "oscillator.type": "triangle",
      "envelope.attack": 0.003,
      "envelope.decay": 0.6,
      "envelope.sustain": 0,
      "envelope.release": 0.4,
    },
    events: parts(
      lines(all, (bar, at) =>
        hand(bar, "lh", at).map((note) => ({
          ...note,
          note: up(note.note, 1),
          length: 2,
        })),
      ),
    ),
  });
  b.add("tone/PingPongDelay", "harp.shimmer", {
    ...inHarp,
    name: "Harp",
    values: { delayTime: 0.23, feedback: 0.2, wet: 0.12 },
  });
  b.add("tone/Channel", "harp.bus", {
    ...inHarp,
    name: "Harp",
    values: { pan: -0.35 },
  });
  b.chain("harp.harp", "harp.shimmer", "harp.bus");
  b.patch(out("harp.bus"), out(harp, "mix"));

  // Strings: cellos take the left hand as written from the start; the
  // basses and the sustained chords join for the second time through.
  const strings = b.tree("strings", "Strings", { outputs: ["Mix"] });
  const inStrings = { parentId: strings };
  b.add("tone/MonoSynth", "strings.cello", {
    ...inStrings,
    name: "Cello",
    values: {
      volume: -12,
      "oscillator.type": "sawtooth",
      "envelope.attack": 0.03,
      "envelope.decay": 0.2,
      "envelope.sustain": 0.6,
      "envelope.release": 0.3,
      "filter.Q": 1,
      "filterEnvelope.baseFrequency": 300,
      "filterEnvelope.octaves": 1.5,
      "filterEnvelope.attack": 0.05,
      "filterEnvelope.sustain": 0.6,
    },
    events: parts(
      lines(all, (bar, at) =>
        hand(bar, "lh", at).map((note) => ({ ...note, length: 2 })),
      ),
    ),
  });
  b.add("tone/MonoSynth", "strings.bass", {
    ...inStrings,
    name: "Double bass",
    values: {
      volume: -8,
      "oscillator.type": "triangle",
      "envelope.attack": 0.06,
      "envelope.decay": 0.3,
      "envelope.sustain": 0.7,
      "envelope.release": 0.4,
      "filterEnvelope.baseFrequency": 120,
      "filterEnvelope.octaves": 1,
    },
    events: parts(
      lines(fromSecond, (bar, at) =>
        bar.root === undefined
          ? []
          : [{ slot: at, note: bar.root, length: slotsPerBar }],
      ),
    ),
  });
  b.add("tone/PolySynth (Synth)", "strings.section", {
    ...inStrings,
    name: "Strings",
    values: {
      volume: -22,
      "oscillator.type": "sawtooth",
      "envelope.attack": 0.5,
      "envelope.decay": 0.3,
      "envelope.sustain": 0.8,
      "envelope.release": 1,
    },
    events: parts(tied(lines(fromSecond, (bar, at) => held(bar.chord, at)))),
  });
  b.add("tone/Chorus", "strings.ensemble", {
    ...inStrings,
    name: "Strings",
    values: { frequency: 0.5, depth: 0.4, wet: 0.35 },
  });
  b.add("tone/Filter", "strings.warmth", {
    ...inStrings,
    name: "Strings",
    values: { type: "lowpass", frequency: 3200, Q: 0.7 },
  });
  b.add("tone/Channel", "strings.bus", {
    ...inStrings,
    name: "Strings",
    values: { volume: -2 },
  });
  b.chain(
    "strings.section",
    "strings.ensemble",
    "strings.warmth",
    "strings.bus",
  );
  b.chain("strings.cello", "strings.bus");
  b.chain("strings.bass", "strings.bus");
  b.patch(out("strings.bus"), out(strings, "mix"));

  // Brass: horns under the episode's first four bars, and under the close.
  const brass = b.tree("brass", "Brass", { outputs: ["Mix"] });
  const inBrass = { parentId: brass };
  const hornBars = ["9", "10", "11", "12"];
  b.add("tone/PolySynth (FMSynth)", "brass.horns", {
    ...inBrass,
    name: "Horns",
    values: {
      volume: -20,
      harmonicity: 1,
      modulationIndex: 1.4,
      "envelope.attack": 0.15,
      "envelope.decay": 0.2,
      "envelope.sustain": 0.8,
      "envelope.release": 0.9,
      "modulationEnvelope.attack": 0.4,
    },
    events: parts(
      tied(
        lines(episodes, (bar, at, key) =>
          hornBars.includes(key) || key === "22"
            ? held(
                bar.chord?.map((note) => up(note, -1)),
                at,
              )
            : [],
        ),
      ),
    ),
  });
  b.add("tone/Compressor", "brass.comp", {
    ...inBrass,
    name: "Horns",
    values: { threshold: -20, ratio: 3, attack: 0.02, release: 0.2 },
  });
  b.add("tone/Channel", "brass.bus", {
    ...inBrass,
    name: "Brass",
    values: { volume: -3, pan: 0.25 },
  });
  b.chain("brass.horns", "brass.comp", "brass.bus");
  b.patch(out("brass.bus"), out(brass, "mix"));

  // Percussion: timpani for the last time through, with a roll into the close.
  const percussion = b.tree("percussion", "Percussion", { outputs: ["Mix"] });
  const inPercussion = { parentId: percussion };
  const closing = score.findIndex(([, key]) => key === "22") * slotsPerBar;
  b.add("tone/MembraneSynth", "percussion.timpani", {
    ...inPercussion,
    name: "Timpani",
    values: {
      volume: -8,
      pitchDecay: 0.08,
      octaves: 3,
      "envelope.decay": 0.9,
      "envelope.sustain": 0.01,
      "envelope.release": 1.4,
    },
    events: [
      ...parts(
        lines(["B2"], (bar, at, key) =>
          key === "9" || key === "11" || key === "22"
            ? [{ slot: at, note: up(bar.root!, 0), length: 2 }]
            : [],
        ),
      ),
      ...parts(
        [3, 4, 5].map((slot) => ({
          slot: closing - slotsPerBar + slot,
          note: "A1",
          length: 1,
        })),
        { velocity: 0.4 },
      ),
    ],
  });
  b.add("tone/Compressor", "percussion.comp", {
    ...inPercussion,
    name: "Timpani",
    values: { threshold: -14, ratio: 4, attack: 0.01, release: 0.3 },
  });
  b.add("tone/Channel", "percussion.bus", {
    ...inPercussion,
    name: "Percussion",
    values: { volume: -2 },
  });
  b.chain("percussion.timpani", "percussion.comp", "percussion.bus");
  b.patch(out("percussion.bus"), out(percussion, "mix"));

  // The hall: glue, a long reverb, a limiter and two readouts.
  const hall = b.tree("hall", "Hall", { inputs: ["Mix"], outputs: ["Mix"] });
  const inHall = { parentId: hall };
  b.add("tone/Compressor", "hall.glue", {
    ...inHall,
    name: "Glue",
    values: { threshold: -18, ratio: 2, attack: 0.03, release: 0.3, knee: 20 },
  });
  b.add("tone/Filter", "hall.rumble", {
    ...inHall,
    name: "Rumble",
    values: { type: "highpass", frequency: 35, Q: 0.7 },
  });
  b.add("tone/Reverb", "hall.room", {
    ...inHall,
    name: "Hall",
    values: { decay: 4.5, preDelay: 0.03, wet: 0.3 },
  });
  b.add("tone/Limiter", "hall.limiter", {
    ...inHall,
    name: "Safety",
    values: { threshold: -2 },
  });
  b.add("tone/Meter", "hall.meter", { ...inHall, name: "Hall" });
  b.add("tone/Waveform", "hall.scope", { ...inHall, name: "Hall" });
  b.patch(inp(hall, "mix"), inp("hall.glue"));
  b.chain(
    "hall.glue",
    "hall.rumble",
    "hall.room",
    "hall.limiter",
    "hall.meter",
    "hall.scope",
  );
  b.patch(out("hall.scope"), out(hall, "mix"));

  b.add("tone/Destination", "out");
  for (const group of [winds, harp, strings, brass, percussion]) {
    b.patch(out(group, "mix"), inp(hall, "mix"));
  }
  b.patch(out(hall, "mix"), inp("out"));

  return b.build();
};

// How long one time through the score lasts, for the demo's blurb.
export const furEliseSeconds = (bpm: number) =>
  (score.length * slotsPerBar * 60) / (bpm * 4);
