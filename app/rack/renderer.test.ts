import { beforeEach, expect, test, vi } from "vitest";
import type * as ToneJs from "tone";
import { diffRack, emptyRackState, type RackOp } from "./diff";
import { createRenderer } from "./renderer";
import type {
  Jack,
  LeafRack,
  Patch,
  Rack,
  RackEvent,
  RackState,
} from "./model";
import { triggerAttackRelease } from "../catalogue/kit";

// A stand-in for Tone that records what is done to it.
class FakeNode {
  readonly connected: FakeNode[] = [];
  disposed = false;
  readonly params: object[] = [];
  readonly played: unknown[][] = [];
  readonly envelope = { attack: 0 };
  readonly frequency = {
    ramped: [] as unknown[][],
    // Every call on the param in order, ramps included.
    calls: [] as unknown[][],
    rampTo(...args: unknown[]) {
      this.ramped.push(args);
      this.calls.push(["rampTo", ...args]);
    },
    setValueAtTime(...args: unknown[]) {
      this.calls.push(["setValueAtTime", ...args]);
    },
    cancelScheduledValues(...args: unknown[]) {
      this.calls.push(["cancelScheduledValues", ...args]);
    },
  };
  constructor(readonly name: string) {
    made.push(this);
  }
  set(props: object) {
    this.params.push(props);
  }
  get() {
    return { forwarded: { gain: 0 } };
  }
  connect(to: FakeNode) {
    if (!(to instanceof FakeNode) || to.name === "noInput") {
      throw new Error("Cannot connect to node with no inputs");
    }
    this.connected.push(to);
  }
  disconnect(to: FakeNode) {
    this.connected.splice(
      0,
      this.connected.length,
      ...this.connected.filter((n) => n !== to),
    );
  }
  dispose() {
    this.disposed = true;
  }
  triggerAttackRelease(...args: unknown[]) {
    this.played.push(args);
  }
}

let made: FakeNode[] = [];
let speakers: FakeNode;
let sequences: {
  play: (time: number, value: unknown) => void;
  disposed: boolean;
}[] = [];
let toneEvents: {
  play: (time: number, value: unknown) => void;
  value: unknown;
}[] = [];
let transport: {
  bpm: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  schedule: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  state: "started" | "stopped";
  seconds: number;
};
let suspend: ReturnType<typeof vi.fn>;
let errors: string[];
let renderer: ReturnType<typeof createRenderer>;

const fakeTone = () =>
  ({
    Gain: class extends FakeNode {
      constructor() {
        super("gain");
      }
    },
    Synth: class extends FakeNode {
      constructor() {
        super("synth");
      }
    },
    Sink: class extends FakeNode {
      constructor() {
        super("noInput");
      }
    },
    // A node with a part a jack can reach on its own.
    Filter: class extends FakeNode {
      readonly cutoff = new FakeNode("cutoff");
      constructor() {
        super("filter");
      }
    },
    Sequence: class {
      constructor(play: (time: number, value: unknown) => void) {
        sequences.push(Object.assign(this, { play, disposed: false }));
      }
      start() {
        return this;
      }
      dispose() {
        (this as unknown as { disposed: boolean }).disposed = true;
      }
    },
    // Tone's ToneEvent has a null value when given none.
    ToneEvent: class {
      loop: unknown;
      constructor(play: (time: number, value: unknown) => void, value = null) {
        toneEvents.push({ play, value });
      }
      start() {
        return this;
      }
      dispose() {}
    },
    getDestination: () => speakers,
    getTransport: () => transport,
    getContext: () => ({ rawContext: { suspend } }),
    start: () => Promise.resolve(),
    now: () => 5,
    Time: (time: string) => ({ toSeconds: () => Number(time) }),
  }) as unknown as typeof ToneJs;

const code = (body: string) => `Effect.gen(function* () {
  const { tone } = yield* RenderContext;
  return ${body};
})`;

const leaf = (id: string, body = "new tone.Synth()"): LeafRack => ({
  id,
  name: id,
  type: "leaf",
  isRoot: false,
  parentId: "root",
  jackIds: [],
  methodIds: [],
  eventIds: [],
  code: code(body),
});

const tree = (id: string): Rack => ({
  id,
  name: id,
  type: "tree",
  isRoot: false,
  parentId: "root",
  jackIds: [],
  methodIds: [],
  eventIds: [],
  children: [],
  patches: [],
});

const jack = (rackId: string, direction: Jack["direction"]): Jack => ({
  id: `${rackId}:${direction}`,
  name: direction,
  belongToBlockId: rackId,
  direction,
});

const patch = (id: string, from: string, to: string): Patch => ({
  id,
  name: id,
  from,
  to,
});

const frequency = (rackId: string) => ({
  id: `${rackId}:frequency`,
  name: "Frequency",
  belongToRackId: rackId,
  kind: "number" as const,
  path: ["frequency"],
  defaultValue: 440,
});

const volume = (rackId: string) => ({
  id: `${rackId}:volume`,
  name: "Volume",
  belongToRackId: rackId,
  kind: "number" as const,
  path: ["envelope", "attack"],
  defaultValue: 0,
});

let current: RackState;
const go = (overrides: Partial<RackState>): RackOp[] => {
  const next = { ...current, ...overrides };
  const ops = diffRack(current, next);
  current = next;
  renderer.apply(ops);
  return ops;
};

const synthIntoSpeakers = {
  racks: {
    S: leaf("S"),
    D: leaf("D", "tone.getDestination()"),
  },
  jacks: {
    "S:out": jack("S", "out"),
    "D:in": jack("D", "in"),
  },
  patches: { p: patch("p", "S:out", "D:in") },
};

const synth = () => made.find((node) => node.name === "synth") as FakeNode;

beforeEach(() => {
  made = [];
  sequences = [];
  toneEvents = [];
  speakers = new FakeNode("speakers");
  suspend = vi.fn(() => Promise.resolve());
  transport = {
    bpm: { value: 120 },
    start: vi.fn(),
    stop: vi.fn(),
    schedule: vi.fn(() => 7),
    clear: vi.fn(),
    state: "stopped",
    seconds: 0,
  };
  errors = [];
  current = emptyRackState;
  renderer = createRenderer({
    tone: fakeTone(),
    report: (message) => errors.push(message),
  });
});

test("evals a leaf's code and connects it as its patches say", () => {
  go(synthIntoSpeakers);

  expect(synth().connected).toEqual([speakers]);
  expect(errors).toEqual([]);
});

test("reports a leaf that fails, and builds the rest", () => {
  go({
    racks: {
      bad: {
        ...leaf("bad"),
        code: `Effect.fail(new LeafError({ message: "Leaf has no code" }))`,
      },
      typo: { ...leaf("typo"), code: "this is not code" },
      S: leaf("S"),
    },
  });

  expect(errors).toHaveLength(2);
  expect(errors[0]).toContain("Leaf has no code");
  expect(synth()).toBeDefined();
});

test("applies a rack's values when built and as they change", () => {
  go({
    racks: { S: { ...leaf("S"), paramGroupId: "g" } },
    paramGroups: { g: { id: "g", params: [volume("S")] } },
    values: { "S:volume": 1 },
  });
  expect(synth().params).toEqual([{ envelope: { attack: 1 } }]);

  go({ values: { "S:volume": 2 } });
  expect(synth().params.at(-1)).toEqual({ envelope: { attack: 2 } });
  expect(synth().params).toHaveLength(2);
});

test("sets a param the node only has through get()", () => {
  go({
    racks: { S: { ...leaf("S"), paramGroupId: "g" } },
    paramGroups: {
      g: { id: "g", params: [{ ...volume("S"), path: ["forwarded", "gain"] }] },
    },
    values: { "S:volume": 1 },
  });

  expect(synth().params).toEqual([{ forwarded: { gain: 1 } }]);
  expect(errors).toEqual([]);
});

test("reports a param whose path the node doesn't have", () => {
  go({
    racks: { S: { ...leaf("S"), paramGroupId: "g" } },
    paramGroups: {
      g: {
        id: "g",
        params: [{ ...volume("S"), path: ["enevlope", "attack"] }],
      },
    },
    values: { "S:volume": 1 },
  });

  expect(synth().params).toEqual([]);
  expect(errors).toEqual(["Volume can't be set: synth has no enevlope.attack"]);
});

test("disconnects a removed patch", () => {
  go(synthIntoSpeakers);
  go({ patches: {} });

  expect(synth().connected).toEqual([]);
});

test("reports a patch that can't connect, once", () => {
  go({
    racks: { S: leaf("S"), N: leaf("N", "new tone.Sink()") },
    jacks: { "S:out": jack("S", "out"), "N:in": jack("N", "in") },
    patches: { p: patch("p", "S:out", "N:in") },
  });
  go({ values: { unrelated: 1 } });
  go({ jacks: { ...current.jacks } });

  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain("no inputs");
});

test("passes signal through a tree's jacks", () => {
  go({
    racks: {
      S: leaf("S"),
      T: tree("T"),
      D: leaf("D", "tone.getDestination()"),
    },
    jacks: {
      "S:out": jack("S", "out"),
      "T:in": jack("T", "in"),
      "T:out": jack("T", "out"),
      "D:in": jack("D", "in"),
    },
    patches: {
      a: patch("a", "S:out", "T:in"),
      b: patch("b", "T:out", "D:in"),
    },
  });

  const gains = made.filter((node) => node.name === "gain");
  expect(gains).toHaveLength(2);
  expect(synth().connected).toEqual([gains[0]]);
  expect(gains[1]?.connected).toEqual([speakers]);
});

test("rewires a rack whose code changes", () => {
  go(synthIntoSpeakers);
  const old = synth();

  go({
    racks: {
      ...current.racks,
      S: leaf("S", "new tone.Synth() /* changed */"),
    },
  });

  const replaced = made.filter((node) => node.name === "synth").at(-1);
  expect(old.disposed).toBe(true);
  expect(replaced).not.toBe(old);
  expect(replaced?.connected).toEqual([speakers]);
});

test("leaves a rack alone when something else about it changes", () => {
  go(synthIntoSpeakers);
  const held = synth();

  go({
    racks: {
      ...current.racks,
      S: { ...leaf("S"), name: "Renamed" },
    },
  });

  expect(held.disposed).toBe(false);
  expect(made.filter((node) => node.name === "synth")).toHaveLength(1);
});

test("never disposes the speakers, only what feeds them", () => {
  go(synthIntoSpeakers);
  go({ racks: { S: leaf("S") }, jacks: { "S:out": jack("S", "out") } });

  expect(speakers.disposed).toBe(false);
  expect(synth().connected).toEqual([]);
});

test("keeps feeding the speakers through a second Destination", () => {
  go({
    racks: {
      S: leaf("S"),
      A: leaf("A", "tone.getDestination()"),
      B: leaf("B", "tone.getDestination()"),
    },
    jacks: {
      "S:out": jack("S", "out"),
      "A:in": jack("A", "in"),
      "B:in": jack("B", "in"),
    },
    patches: {
      a: patch("a", "S:out", "A:in"),
      b: patch("b", "S:out", "B:in"),
    },
  });

  go({ patches: { b: patch("b", "S:out", "B:in") } });

  expect(synth().connected).toContain(speakers);
});

const riff: RackEvent = {
  kind: "sequence",
  id: "riff",
  belongToBlockId: "S",
  methodId: "m",
  args: { duration: "16n" },
  mute: false,
  steps: ["C3", null],
  subdivision: "8n",
};

test("plays a step through the method its event names", () => {
  go({
    ...synthIntoSpeakers,
    methods: {
      m: { ...triggerAttackRelease(), id: "m", belongToBlockId: "S" },
    },
    events: { riff },
  });

  sequences[0]?.play(1.5, "C3");

  expect(synth().played).toEqual([["C3", "16n", 1.5, 1]]);
});

test("rebuilds an event when it changes, and not at all when muted", () => {
  go({ ...synthIntoSpeakers, events: { riff } });

  go({ events: { riff: { ...riff, steps: ["D3"] } } });
  expect(sequences).toHaveLength(2);
  expect(sequences[0]?.disposed).toBe(true);

  go({ events: { riff: { ...riff, mute: true } } });
  expect(sequences).toHaveLength(2);
  expect(sequences[1]?.disposed).toBe(true);
});

test("starts and stops the transport, and follows its tempo", async () => {
  go({ transport: { bpm: 90, playing: true } });
  expect(transport.bpm.value).toBe(90);
  await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce());

  go({ transport: { bpm: 90, playing: false } });
  expect(transport.stop).toHaveBeenCalledOnce();
  expect(suspend).toHaveBeenCalledOnce();
});

test("doesn't start a transport stopped before audio came up", async () => {
  go({ transport: { bpm: 120, playing: true } });
  go({ transport: { bpm: 120, playing: false } });

  await Promise.resolve();
  await Promise.resolve();
  expect(transport.start).not.toHaveBeenCalled();
});

test("schedules automation on the transport, and replaces it", () => {
  const event = { id: "e", method: "rampTo", value: 1, time: "2" } as const;
  go({ automations: { p: [event] } });
  expect(transport.schedule).toHaveBeenCalledOnce();

  go({ automations: { p: [] } });
  expect(transport.clear).toHaveBeenCalledWith(7);
  expect(transport.schedule).toHaveBeenCalledOnce();
});

test("lands automation added while the transport plays, due ones now", () => {
  go({
    racks: { S: { ...leaf("S"), paramGroupId: "g" } },
    paramGroups: { g: { id: "g", params: [frequency("S")] } },
  });
  transport.state = "started";
  transport.seconds = 3;
  const past = { id: "a", method: "rampTo", value: 1, time: "1" } as const;
  const ahead = { id: "b", method: "rampTo", value: 2, time: "6" } as const;

  go({ automations: { "S:frequency": [past, ahead] } });

  // Still scheduled for the next start, and landed right away as well: the
  // transport started at 2, so the first event was due at 3 and lands now (5),
  // and the second at 8.
  expect(transport.schedule).toHaveBeenCalledWith(expect.any(Function), 0);
  expect(synth().frequency.ramped).toEqual([
    [1, undefined, 5],
    [2, undefined, 8],
  ]);
});

const automatedSynth = {
  racks: { S: { ...leaf("S"), paramGroupId: "g" } },
  paramGroups: { g: { id: "g", params: [frequency("S")] } },
  values: { "S:frequency": 440 },
};

test("clears an emptied list off the param and gives it its value back", () => {
  const event = { id: "a", method: "rampTo", value: 1, time: "2" } as const;
  go({ ...automatedSynth, automations: { "S:frequency": [event] } });
  synth().params.length = 0;

  go({ automations: { "S:frequency": [] } });

  expect(synth().frequency.calls).toEqual([["cancelScheduledValues", 0]]);
  expect(synth().params).toEqual([{ frequency: 440 }]);
});

test("clears a list edited while the transport plays before the new one lands", () => {
  go(automatedSynth);
  transport.state = "started";
  transport.seconds = 3;
  const first = { id: "a", method: "setValueAtTime", value: 1, time: "6" };
  go({ automations: { "S:frequency": [first] } as RackState["automations"] });
  const calls = synth().frequency.calls;
  calls.length = 0;
  synth().params.length = 0;

  const second = { ...first, value: 2 };
  go({ automations: { "S:frequency": [second] } as RackState["automations"] });

  expect(calls).toEqual([
    ["cancelScheduledValues", 0],
    ["setValueAtTime", 2, 8],
  ]);
  expect(synth().params).toEqual([{ frequency: 440 }]);
});

test("clears automated params when the transport stops", async () => {
  const event = { id: "a", method: "rampTo", value: 1, time: "2" } as const;
  go({
    ...automatedSynth,
    automations: { "S:frequency": [event] },
    transport: { bpm: 120, playing: true },
  });
  await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce());
  synth().params.length = 0;

  go({ transport: { bpm: 120, playing: false } });

  expect(synth().frequency.calls).toEqual([["cancelScheduledValues", 0]]);
  expect(synth().params).toEqual([{ frequency: 440 }]);
});

test("lands automation again on a rack rebuilt while the transport plays", () => {
  const event = { id: "a", method: "rampTo", value: 1, time: "6" } as const;
  go({ ...automatedSynth, automations: { "S:frequency": [event] } });
  transport.state = "started";
  transport.seconds = 3;

  go({
    racks: {
      S: { ...leaf("S", "new tone.Synth() /* changed */"), paramGroupId: "g" },
    },
  });

  const rebuilt = made.filter((node) => node.name === "synth").at(-1);
  expect(rebuilt).not.toBe(synth());
  expect(rebuilt?.frequency.calls).toEqual([
    ["cancelScheduledValues", 0],
    ["rampTo", 1, undefined, 8],
  ]);
  expect(transport.schedule).toHaveBeenCalledTimes(2);
});

test("starts over from nothing on reset", () => {
  go({
    ...synthIntoSpeakers,
    events: { riff },
    transport: { bpm: 90, playing: true },
  });
  const held = synth();

  renderer.reset();
  current = emptyRackState;

  expect(held.disposed).toBe(true);
  expect(sequences[0]?.disposed).toBe(true);
  expect(transport.stop).toHaveBeenCalledOnce();
  expect(transport.bpm.value).toBe(120);

  go(synthIntoSpeakers);
  expect(made.filter((node) => node.name === "synth")).toHaveLength(2);
});

test("unpatches a rack's member before rebuilding it, and patches the new one", () => {
  go({
    racks: { S: leaf("S"), F: leaf("F", "new tone.Filter()") },
    jacks: {
      "S:out": jack("S", "out"),
      "F:cutoff": { ...jack("F", "in"), port: { member: ["cutoff"] } },
    },
    patches: { p: patch("p", "S:out", "F:cutoff") },
  });
  const old = made.find((node) => node.name === "cutoff") as FakeNode;
  const disposed: boolean[] = [];
  const disconnect = synth().disconnect.bind(synth());
  synth().disconnect = (to: FakeNode) => {
    disposed.push(
      (made.find((node) => node.name === "filter") as FakeNode).disposed,
    );
    disconnect(to);
  };

  go({ racks: { ...current.racks, F: leaf("F", "new tone.Filter() // new") } });

  const cutoffs = made.filter((node) => node.name === "cutoff");
  expect(cutoffs).toHaveLength(2);
  expect(disposed).toEqual([false]);
  expect(synth().connected).toEqual([cutoffs[1]]);
  expect(synth().connected).not.toContain(old);
  expect(errors).toEqual([]);
});

test("reports a patch that can't be put back, and applies the rest", () => {
  go({
    racks: {
      S: leaf("S"),
      A: leaf("A", "tone.getDestination()"),
      B: leaf("B", "tone.getDestination()"),
    },
    jacks: {
      "S:out": jack("S", "out"),
      "A:in": jack("A", "in"),
      "B:in": jack("B", "in"),
    },
    patches: {
      a: patch("a", "S:out", "A:in"),
      b: patch("b", "S:out", "B:in"),
    },
  });
  synth().connect = () => {
    throw new Error("no way back");
  };

  go({ patches: { b: patch("b", "S:out", "B:in") }, events: { riff } });

  expect(errors).toEqual(["Patch b can't be put back: no way back"]);
  expect(sequences).toHaveLength(1);
});

test("plays a loop with no value with the note from its args", () => {
  const loop: RackEvent = {
    kind: "event",
    id: "loop",
    belongToBlockId: "S",
    methodId: "m",
    args: { note: "E4", duration: "8n" },
    mute: false,
    start: "0",
    loop: true,
    loopEnd: "1m",
  };
  go({
    ...synthIntoSpeakers,
    methods: {
      m: { ...triggerAttackRelease(), id: "m", belongToBlockId: "S" },
    },
    events: { loop },
  });

  toneEvents[0]?.play(2, toneEvents[0].value);

  expect(toneEvents[0]?.value).toBeNull();
  expect(synth().played).toEqual([["E4", "8n", 2, 1]]);
});

test("builds a leaf whose code ends in a line comment", () => {
  go({
    racks: { S: { ...leaf("S"), code: `${code("new tone.Synth()")} // why` } },
  });

  expect(synth()).toBeDefined();
  expect(errors).toEqual([]);
});

test("reports a failed leaf once, and tries it again when its code changes", () => {
  const broken = { ...leaf("S"), code: "this is not code" };
  go({ racks: { S: broken } });
  go({ racks: { S: { ...broken, name: "Renamed" } } });
  expect(errors).toHaveLength(1);

  go({ racks: { S: { ...broken, code: "still not code" } } });
  expect(errors).toHaveLength(2);

  go({ racks: { S: leaf("S") } });
  expect(synth()).toBeDefined();
  expect(errors).toHaveLength(2);
});
