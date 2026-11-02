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
import { triggerAttackRelease } from "../catalogue/common";

// A stand-in for Tone that records what is done to it.
class FakeNode {
  readonly connected: FakeNode[] = [];
  disposed = false;
  readonly params: object[] = [];
  readonly played: unknown[][] = [];
  constructor(readonly name: string) {
    made.push(this);
  }
  set(props: object) {
    this.params.push(props);
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
let transport: {
  bpm: { value: number };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  schedule: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
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
    getDestination: () => speakers,
    getTransport: () => transport,
    getContext: () => ({ rawContext: { suspend } }),
    start: () => Promise.resolve(),
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
  speakers = new FakeNode("speakers");
  suspend = vi.fn(() => Promise.resolve());
  transport = {
    bpm: { value: 120 },
    start: vi.fn(),
    stop: vi.fn(),
    schedule: vi.fn(() => 7),
    clear: vi.fn(),
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
    methods: { m: { ...triggerAttackRelease("S"), id: "m" } },
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
