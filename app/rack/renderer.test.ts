// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Effect, Exit } from "effect";
import * as ToneJs from "tone";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { makeToneRuntime, type ToneRuntime } from "./renderer";
import { CATALOGUE } from "../catalogue";
import { rackStore } from "./store";
import { Tone, type RackTemplate } from "./model";
import { rackActions } from "../testing/rack-actions";

const rack = rackActions(rackStore);

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

// An offline context renders into a buffer instead of the speakers, and its
// clock stands still, so scheduled values can be read back at fixed times.
ToneJs.setContext(
  new ToneJs.OfflineContext(new OfflineAudioContext(2, 44100, 44100)),
);

const initial = rackStore.getState();
const store = () => rackStore.getState();

const defined = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
};

// The sample rack: an AMSynth patched into the Destination, both directly
// under the root. The store's own runtime stays the no-op one, so building
// the rack here touches no audio; each test drives the runtime itself.
const buildSampleRack = () => {
  const synth = defined(
    rack.addTemplate(template("instruments", "AMSynth")),
    "AMSynth",
  );
  const destination = defined(
    rack.addTemplate(template("output", "Destination")),
    "Destination",
  );
  const patch = defined(
    rack.connectJacks(`${synth}:out`, `${destination}:in`),
    "patch",
  );
  return { synth, destination, patch };
};

const param = (blockId: string, path: string) => `${blockId}:param:${path}`;
const method = (blockId: string, key: string) => `${blockId}:method:${key}`;

const makeRuntime = () =>
  Effect.runPromise(
    makeToneRuntime(store).pipe(Effect.provideService(Tone, ToneJs)),
  );

const rendered = (runtime: ToneRuntime) => Effect.runPromise(runtime.rendered);

const nodeOf = async <T = ToneJs.AMSynth>(
  runtime: ToneRuntime,
  blockId: string,
) => {
  const block = (await rendered(runtime)).blocks.get(blockId);
  if (block?.kind !== "leaf" || !Exit.isSuccess(block.exit)) {
    throw new Error(`${blockId} did not render`);
  }
  return block.exit.value as T;
};

beforeEach(() => {
  rackStore.setState(initial, true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("render builds a node for each leaf and records the root tree", async () => {
  const { synth, destination } = buildSampleRack();
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  expect(await nodeOf(runtime, synth)).toBeInstanceOf(ToneJs.AMSynth);
  expect(await nodeOf(runtime, destination)).toBe(ToneJs.getDestination());
  expect((await rendered(runtime)).blocks.get("root")).toEqual({
    kind: "tree",
    blockId: "root",
    parentId: undefined,
  });
});

test("render applies the store's param values to the node", async () => {
  const { synth } = buildSampleRack();
  rack.setParamValue(param(synth, "volume"), -6);
  rack.setParamValue(param(synth, "oscillator.type"), "square");
  rack.setParamValue(param(synth, "envelope.attack"), 0.2);
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const node = await nodeOf(runtime, synth);
  expect(node.volume.value).toBeCloseTo(-6);
  expect(node.oscillator.type).toBe("square");
  expect(node.envelope.attack).toBe(0.2);
});

test("a leaf whose code fails is stored as failed and the rest still render", async () => {
  const { synth } = buildSampleRack();
  // A blank leaf has no code yet, so building it fails.
  const blank = defined(rack.addBlock("leaf"), "blank leaf");
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const block = (await rendered(runtime)).blocks.get(blank);
  expect(block?.kind === "leaf" && Exit.isFailure(block.exit)).toBe(true);
  expect(await nodeOf(runtime, synth)).toBeInstanceOf(ToneJs.AMSynth);
});

test("a patch into the Destination sends the source to the speakers", async () => {
  const { synth, destination, patch } = buildSampleRack();
  const connect = vi.spyOn(ToneJs.ToneAudioNode.prototype, "connect");
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const node = await nodeOf(runtime, synth);
  const fromSynth = connect.mock.calls.filter(
    (_, call) => connect.mock.contexts[call] === node,
  );
  expect(fromSynth).toEqual([[ToneJs.getDestination()]]);
  expect((await rendered(runtime)).patches.get(patch)?.exit).toEqual(
    Exit.succeed({ fromBlockId: synth, toBlockId: destination }),
  );
});

test("a patch to a failed leaf is stored as failed and the rest still connect", async () => {
  const { synth, patch } = buildSampleRack();
  const blank = defined(rack.addBlock("leaf"), "blank leaf");
  const broken = defined(
    rack.connectJacks(`${synth}:out`, `${blank}:in`),
    "patch to blank leaf",
  );
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const { patches } = await rendered(runtime);
  expect(Exit.isFailure(defined(patches.get(broken), "broken").exit)).toBe(
    true,
  );
  expect(Exit.isSuccess(defined(patches.get(patch), "patch").exit)).toBe(true);
});

test("updateParam changes the existing node in place", async () => {
  const { synth } = buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const before = await nodeOf(runtime, synth);

  rack.setParamValue(param(synth, "volume"), -12);
  await Effect.runPromise(runtime.updateParam(param(synth, "volume")));

  const after = await nodeOf(runtime, synth);
  expect(after).toBe(before);
  expect(after.volume.value).toBeCloseTo(-12);
});

test("updateParam replaces scheduled automation and keeps the value", async () => {
  const { synth } = buildSampleRack();
  const volume = param(synth, "volume");
  rack.setParamValue(volume, -12);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const node = await nodeOf(runtime, synth);

  const eventId = defined(
    rack.addAutomation(volume, {
      method: "setValueAtTime",
      value: -20,
      time: "1",
    }),
    "automation",
  );
  await Effect.runPromise(runtime.updateParam(volume));

  expect(node.volume.getValueAtTime(0.5)).toBeCloseTo(-12);
  expect(node.volume.getValueAtTime(2)).toBeCloseTo(-20);

  rack.removeAutomation(volume, eventId);
  await Effect.runPromise(runtime.updateParam(volume));

  expect(node.volume.getValueAtTime(2)).toBeCloseTo(-12);
});

test.each(["1", "8n"])(
  "schedules an earlier ramp at %s before a later set regardless of insertion order",
  async (time) => {
    const { synth } = buildSampleRack();
    const volume = param(synth, "volume");
    rack.setParamValue(volume, -12);
    const runtime = await makeRuntime();
    await Effect.runPromise(runtime.render);

    defined(
      rack.addAutomation(volume, {
        method: "setValueAtTime",
        value: -20,
        time: "5",
      }),
      "later set",
    );
    defined(
      rack.addAutomation(volume, {
        method: "rampTo",
        value: -6,
        time,
        rampTime: "1",
      }),
      "earlier ramp",
    );
    const events = [...store().automations[volume]];
    await Effect.runPromise(runtime.updateParam(volume));

    const node = await nodeOf(runtime, synth);
    expect(node.volume.getValueAtTime(3)).toBeCloseTo(-6);
    expect(node.volume.getValueAtTime(6)).toBeCloseTo(-20);
    expect(store().automations[volume]).toEqual(events);

    await Effect.runPromise(runtime.render);
    const rebuilt = await nodeOf(runtime, synth);
    expect(rebuilt.volume.getValueAtTime(3)).toBeCloseTo(-6);
    expect(rebuilt.volume.getValueAtTime(6)).toBeCloseTo(-20);
  },
);

test("automation times count from when the param is applied", async () => {
  const { synth } = buildSampleRack();
  const volume = param(synth, "volume");
  rack.setParamValue(volume, -12);
  defined(
    rack.addAutomation(volume, {
      method: "setValueAtTime",
      value: -20,
      time: "+1",
    }),
    "automation",
  );
  // The offline clock stands still at 0, so pretend the context has run for
  // a while, as it has by the time anyone presses Run.
  vi.spyOn(ToneJs.Param.prototype, "now").mockReturnValue(5);
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const node = await nodeOf(runtime, synth);
  expect(node.volume.getValueAtTime(5.5)).toBeCloseTo(-12);
  expect(node.volume.getValueAtTime(6.5)).toBeCloseTo(-20);
});

test("updateParam on a bad automation time leaves the param as it was", async () => {
  const { synth } = buildSampleRack();
  const volume = param(synth, "volume");
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const node = await nodeOf(runtime, synth);
  // The store turns bad times away, so put one in behind its back.
  rackStore.setState({
    values: { ...store().values, [volume]: -30 },
    automations: {
      [volume]: [
        { id: "bad", method: "setValueAtTime", value: -20, time: "soon" },
      ],
    },
  });

  const exit = await Effect.runPromiseExit(runtime.updateParam(volume));

  expect(Exit.isFailure(exit)).toBe(true);
  expect(node.volume.value).toBeCloseTo(0);
});

test("changing oscillator type applies the params of the new oscillator", async () => {
  const { synth } = buildSampleRack();
  rack.setParamValue(param(synth, "oscillator.width"), 0.7);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);

  rack.setParamValue(param(synth, "oscillator.type"), "pulse");
  await Effect.runPromise(runtime.updateParam(param(synth, "oscillator.type")));

  const node = await nodeOf(runtime, synth);
  expect(node.oscillator.type).toBe("pulse");
  expect(node.oscillator.width?.value).toBeCloseTo(0.7);
});

test("an FMSynth renders with a value applied in each of its sections", async () => {
  const synth = defined(
    rack.addTemplate(template("instruments", "FMSynth")),
    "FMSynth",
  );
  rack.setParamValue(param(synth, "modulationIndex"), 4);
  rack.setParamValue(param(synth, "oscillator.type"), "triangle");
  rack.setParamValue(param(synth, "envelope.decay"), 0.3);
  rack.setParamValue(param(synth, "modulation.type"), "sine");
  rack.setParamValue(param(synth, "modulationEnvelope.sustain"), 0.4);
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const node = await nodeOf<ToneJs.FMSynth>(runtime, synth);
  expect(node).toBeInstanceOf(ToneJs.FMSynth);
  expect(node.modulationIndex.value).toBeCloseTo(4);
  expect(node.oscillator.type).toBe("triangle");
  expect(node.envelope.decay).toBe(0.3);
  expect(node.modulation.type).toBe("sine");
  expect(node.modulationEnvelope.sustain).toBe(0.4);
});

test("deleteBlock disconnects and disposes the node", async () => {
  const { synth } = buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const node = await nodeOf(runtime, synth);
  const disconnect = vi.spyOn(node, "disconnect");
  const dispose = vi.spyOn(node, "dispose");

  await Effect.runPromise(runtime.deleteBlock(synth));

  expect(disconnect).toHaveBeenCalled();
  expect(dispose).toHaveBeenCalled();
  expect((await rendered(runtime)).blocks.has(synth)).toBe(false);
});

test("deletePatch disconnects the source from the target", async () => {
  const { synth, patch } = buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const disconnect = vi.spyOn(await nodeOf(runtime, synth), "disconnect");

  await Effect.runPromise(runtime.deletePatch(patch));

  expect(disconnect).toHaveBeenCalledWith(ToneJs.getDestination());
  expect((await rendered(runtime)).patches.has(patch)).toBe(false);
});

test("deletePatch keeps a connection another patch still uses", async () => {
  const { synth, destination, patch } = buildSampleRack();
  // A second Destination block is the same Tone output as the first.
  const second = defined(
    rack.addTemplate(template("output", "Destination")),
    "second Destination",
  );
  defined(rack.connectJacks(`${synth}:out`, `${second}:in`), "second patch");
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  expect(await nodeOf(runtime, second)).toBe(
    await nodeOf(runtime, destination),
  );
  const disconnect = vi.spyOn(await nodeOf(runtime, synth), "disconnect");

  await Effect.runPromise(runtime.deletePatch(patch));

  expect(disconnect).not.toHaveBeenCalled();
});

test("runLeafMethod calls the Tone method with the args in order", async () => {
  const { synth } = buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const trigger = vi.spyOn(
    await nodeOf(runtime, synth),
    "triggerAttackRelease",
  );

  await Effect.runPromise(
    runtime.runLeafMethod(method(synth, "triggerAttackRelease"), {
      note: "C4",
      duration: "8n",
    }),
  );

  // `time` was left out and falls to Tone; `velocity` takes its default.
  expect(trigger).toHaveBeenCalledWith("C4", "8n", undefined, 1);
});

test("runLeafMethod fails with a LeafError for an unknown method", async () => {
  buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);

  const exit = await Effect.runPromiseExit(
    runtime.runLeafMethod("no-such-method", {}),
  );

  expect(exit).toEqual(
    Exit.fail(expect.objectContaining({ _tag: "LeafError" })),
  );
});

// Swaps a leaf's code for other source, as an edited leaf would have.
const withCode = (blockId: string, code: string) => {
  const block = store().blocks[blockId];
  if (block?.type !== "leaf") throw new Error("expected a leaf");
  rackStore.setState({
    blocks: { ...store().blocks, [blockId]: { ...block, code } },
  });
};

const leafFailure = async (runtime: ToneRuntime, blockId: string) => {
  const block = (await rendered(runtime)).blocks.get(blockId);
  if (block?.kind !== "leaf" || !Exit.isFailure(block.exit)) {
    throw new Error(`${blockId} did not fail`);
  }
  return block.exit;
};

test.each([
  ["does not parse", "Effect.gen(function* () {", "Leaf code failed"],
  ["throws as it is read", "(() => { throw new Error('boom') })()", "boom"],
  ["is not an Effect", "42", "it is not an Effect"],
  [
    "throws inside its Effect",
    "Effect.sync(() => { throw new Error('inside') })",
    "inside",
  ],
  [
    "builds something else",
    "Effect.succeed({})",
    "did not build a Tone.js node",
  ],
])(
  "a leaf whose code %s fails and the rest still render",
  async (_, code, message) => {
    const { synth, destination } = buildSampleRack();
    withCode(synth, code);
    const runtime = await makeRuntime();

    await Effect.runPromise(runtime.render);

    expect(await leafFailure(runtime, synth)).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: "LeafError",
          message: expect.stringContaining(message),
        }),
      ),
    );
    expect(await nodeOf(runtime, destination)).toBe(ToneJs.getDestination());
  },
);

test("leaf code sees Effect, Tone and LeafError, and nothing of the module", async () => {
  const { synth } = buildSampleRack();
  withCode(
    synth,
    `Effect.gen(function* () {
      if (typeof makeToneRuntime !== "undefined") throw new Error("leaked");
      const tone = yield* Tone;
      return new tone.AMSynth();
    })`,
  );
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  expect(await nodeOf(runtime, synth)).toBeInstanceOf(ToneJs.AMSynth);
});

test("runLeafMethod on a failed leaf fails with that leaf's error", async () => {
  const { synth } = buildSampleRack();
  // Swap the synth's code for one that fails, as a broken leaf would.
  const block = store().blocks[synth];
  if (block?.type !== "leaf") throw new Error("expected a leaf");
  const failing = 'Effect.fail(new LeafError({ message: "broken synth" }))';
  rackStore.setState({
    blocks: { ...store().blocks, [synth]: { ...block, code: failing } },
  });
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);

  const exit = await Effect.runPromiseExit(
    runtime.runLeafMethod(method(synth, "triggerRelease"), {}),
  );

  expect(exit).toEqual(
    Exit.fail(expect.objectContaining({ message: "broken synth" })),
  );
});

test("rendering again disposes the old graph and builds a new one", async () => {
  const { synth } = buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const first = await nodeOf(runtime, synth);
  const dispose = vi.spyOn(first, "dispose");

  await Effect.runPromise(runtime.render);

  const { blocks, patches } = await rendered(runtime);
  expect(dispose).toHaveBeenCalled();
  expect(await nodeOf(runtime, synth)).not.toBe(first);
  expect([blocks.size, patches.size]).toEqual([3, 1]);
});

test("render recurses into a nested tree", async () => {
  // The store only adds blocks under the root, so move a synth into a group
  // by hand.
  const group = defined(rack.addBlock("tree"), "group");
  const synth = defined(
    rack.addTemplate(template("instruments", "AMSynth")),
    "AMSynth",
  );
  const { blocks } = store();
  const root = blocks.root;
  const groupBlock = blocks[group];
  if (root?.type !== "tree" || groupBlock?.type !== "tree") {
    throw new Error("expected trees");
  }
  rackStore.setState({
    blocks: {
      ...blocks,
      root: { ...root, children: [group] },
      [group]: { ...groupBlock, children: [synth] },
      [synth]: { ...blocks[synth], parentId: group },
    },
  });
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  expect(await nodeOf(runtime, synth)).toBeInstanceOf(ToneJs.AMSynth);
  expect((await rendered(runtime)).blocks.get(synth)?.parentId).toBe(group);
});

const knobs = { mute: false } as const;

const addSequence = (synth: string) =>
  defined(
    rack.addEvent(method(synth, "triggerAttackRelease"), {
      kind: "sequence",
      args: { duration: "8n" },
      ...knobs,
      probability: 0.75,
      steps: ["C4", null, "G4"],
      subdivision: "8n",
    }),
    "sequence",
  );

const scheduledOf = async <T>(runtime: ToneRuntime, eventId: string) => {
  const event = (await rendered(runtime)).events.get(eventId);
  if (event === undefined || !Exit.isSuccess(event.exit)) {
    throw new Error(`${eventId} did not render`);
  }
  return event.exit.value as T;
};

test("a sequence renders as a started Tone.Sequence with its knobs", async () => {
  const { synth } = buildSampleRack();
  const eventId = addSequence(synth);
  // A sequence hands its start to an inner Part, so its own state never
  // reads as started.
  const start = vi.spyOn(ToneJs.Sequence.prototype, "start");
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const sequence = await scheduledOf<ToneJs.Sequence>(runtime, eventId);
  expect(sequence).toBeInstanceOf(ToneJs.Sequence);
  expect(sequence.subdivision).toBeCloseTo(ToneJs.Time("8n").toSeconds());
  expect(sequence.probability).toBe(0.75);
  expect(start).toHaveBeenCalledWith(0);
  expect(start.mock.contexts).toContain(sequence);
});

test("a sequence step calls the method with the step and time, skipping rests", async () => {
  const { synth } = buildSampleRack();
  const eventId = addSequence(synth);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const trigger = vi.spyOn(
    await nodeOf(runtime, synth),
    "triggerAttackRelease",
  );
  const sequence = await scheduledOf<ToneJs.Sequence>(runtime, eventId);

  // The offline clock never moves, so fire the steps by hand.
  sequence.callback(1.5, "C4");
  sequence.callback(2, null);

  expect(trigger).toHaveBeenCalledTimes(1);
  expect(trigger).toHaveBeenCalledWith("C4", "8n", 1.5, 1);
});

test("updateEventLive hands a sequence its new steps without rebuilding it", async () => {
  const { synth } = buildSampleRack();
  const eventId = addSequence(synth);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const before = await scheduledOf<ToneJs.Sequence>(runtime, eventId);

  rack.setEventSteps(eventId, ["A3", "B3"]);
  await Effect.runPromise(runtime.updateEventLive(eventId));

  const after = await scheduledOf<ToneJs.Sequence>(runtime, eventId);
  expect(after).toBe(before);
  expect(after.events).toEqual(["A3", "B3"]);
});

test("a looping event renders as a started ToneEvent", async () => {
  const { synth } = buildSampleRack();
  const eventId = defined(
    rack.addEvent(method(synth, "triggerAttackRelease"), {
      kind: "event",
      args: { note: "C2", duration: "16n" },
      ...knobs,
      start: "0",
      loop: 4,
      loopEnd: "4n",
    }),
    "event",
  );
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const event = await scheduledOf<ToneJs.ToneEvent>(runtime, eventId);
  expect(event).toBeInstanceOf(ToneJs.ToneEvent);
  expect(event.loop).toBe(4);
  expect(event.loopEnd).toBeCloseTo(ToneJs.Time("4n").toSeconds());
  expect(event.state).toBe("started");
});

test("a loop fires its method with its fixed args", async () => {
  const { synth } = buildSampleRack();
  const eventId = defined(
    rack.addEvent(method(synth, "triggerAttackRelease"), {
      kind: "event",
      args: { note: "C2", duration: "16n" },
      ...knobs,
      start: "0",
      loop: true,
      loopEnd: "4n",
    }),
    "event",
  );
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const trigger = vi.spyOn(
    await nodeOf(runtime, synth),
    "triggerAttackRelease",
  );

  // Tone fires a ToneEvent that was given no value with null.
  const event = await scheduledOf<ToneJs.ToneEvent>(runtime, eventId);
  event.callback(1.5, null);

  expect(trigger).toHaveBeenCalledWith("C2", "16n", 1.5, 1);
});

test("stop releases a note still held by an instrument", async () => {
  const { synth } = buildSampleRack();
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const node = await nodeOf(runtime, synth);
  const release = vi.spyOn(node, "triggerRelease");
  node.triggerAttack("C3");

  await Effect.runPromise(runtime.stop);

  expect(release).toHaveBeenCalled();
});

test("deleteEvent stops and disposes the Tone event", async () => {
  const { synth } = buildSampleRack();
  const eventId = addSequence(synth);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const dispose = vi.spyOn(
    await scheduledOf<ToneJs.Sequence>(runtime, eventId),
    "dispose",
  );

  await Effect.runPromise(runtime.deleteEvent(eventId));

  expect(dispose).toHaveBeenCalledTimes(1);
  expect((await rendered(runtime)).events.has(eventId)).toBe(false);
});

test("an event on a failed leaf is stored as failed and the rest still render", async () => {
  const { synth } = buildSampleRack();
  const working = addSequence(synth);
  const broken = addSequence(synth);
  const block = store().blocks[synth];
  if (block?.type !== "leaf") throw new Error("expected a leaf");
  // Move the second event onto a blank leaf, whose code fails.
  const blank = defined(rack.addBlock("leaf"), "blank leaf");
  rackStore.setState({
    blocks: {
      ...store().blocks,
      [synth]: { ...block, eventIds: [working] },
      [blank]: { ...store().blocks[blank], eventIds: [broken] },
    },
    events: {
      ...store().events,
      [broken]: { ...store().events[broken], belongToBlockId: blank },
    },
  });
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  const { events } = await rendered(runtime);
  expect(Exit.isFailure(defined(events.get(broken), "broken").exit)).toBe(true);
  expect(Exit.isSuccess(defined(events.get(working), "working").exit)).toBe(
    true,
  );
});

test("render sets the tempo and carries on from where the playhead is", async () => {
  buildSampleRack();
  rack.setTransport({ bpm: 90 });
  const runtime = await makeRuntime();
  const transport = ToneJs.getTransport();
  await Effect.runPromise(runtime.stop);
  transport.ticks = 960;

  await Effect.runPromise(runtime.render);

  expect(transport.bpm.value).toBeCloseTo(90);
  expect(transport.state).toBe("started");
  expect(transport.ticks).toBe(960);
});

test("stop rewinds the transport to the start", async () => {
  const { synth } = buildSampleRack();
  addSequence(synth);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const transport = ToneJs.getTransport();
  transport.ticks = 960;

  await Effect.runPromise(runtime.stop);

  expect(transport.state).toBe("stopped");
  expect(transport.ticks).toBe(0);
  expect(transport.seconds).toBe(0);
  expect((await rendered(runtime)).events.size).toBe(0);
});

// --- Error codes and playback failures -------------------------------------

const failureCode = (exit: Exit.Exit<unknown, { code?: string }>) =>
  Exit.isFailure(exit)
    ? (Exit.findErrorOption(exit) as { value?: { code?: string } }).value?.code
    : undefined;

test.each([
  ["throws", "(() => { throw new Error('boom') })()", "LeafThrew"],
  [
    "fails with its own LeafError",
    'Effect.fail(new LeafError({ message: "no" }))',
    "LeafThrew",
  ],
  ["builds something else", "Effect.succeed({})", "LeafNotANode"],
])("a leaf that %s fails with code %s", async (_, code, expected) => {
  const { synth } = buildSampleRack();
  withCode(synth, code);
  const runtime = await makeRuntime();

  await Effect.runPromise(runtime.render);

  expect(failureCode(await leafFailure(runtime, synth))).toBe(expected);
});

test("what hangs off a failed leaf fails as the leaf's, under its own code", async () => {
  const { synth, destination, patch } = buildSampleRack();
  const eventId = addSequence(synth);
  withCode(synth, "Effect.succeed({})");
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);

  const { patches, events } = await rendered(runtime);
  expect(failureCode(defined(patches.get(patch), "patch").exit)).toBe(
    "EndpointFailed",
  );
  expect(failureCode(defined(events.get(eventId), "event").exit)).toBe(
    "BlockFailed",
  );
  const param = await Effect.runPromiseExit(
    runtime.updateParam(`${synth}:param:volume`),
  );
  expect(failureCode(param)).toBe("BlockFailed");
  expect(await nodeOf(runtime, destination)).toBe(ToneJs.getDestination());
});

test("a scheduled call that fails while playing is reported with its schedule", async () => {
  const { synth } = buildSampleRack();
  const eventId = addSequence(synth);
  const failures: unknown[] = [];
  const runtime = await Effect.runPromise(
    makeToneRuntime(store, {
      onPlaybackFailure: (failure) => failures.push(failure),
    }).pipe(Effect.provideService(Tone, ToneJs)),
  );
  await Effect.runPromise(runtime.render);
  const first = defined(
    (await rendered(runtime)).events.get(eventId),
    "event",
  ).schedule;
  vi.spyOn(
    await nodeOf(runtime, synth),
    "triggerAttackRelease",
  ).mockImplementation(() => {
    throw new Error("bad note");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  (await scheduledOf<ToneJs.Sequence>(runtime, eventId)).callback(1, "C4");
  await Effect.runPromise(runtime.updateEvent(eventId));
  const second = defined(
    (await rendered(runtime)).events.get(eventId),
    "event",
  ).schedule;

  expect(failures).toEqual([
    {
      eventId,
      schedule: first,
      message: expect.stringContaining("bad note"),
    },
  ]);
  expect(second).not.toBe(first);
  warn.mockRestore();
});
