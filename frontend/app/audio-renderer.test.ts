// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Effect, Exit } from "effect";
import * as ToneJs from "tone";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  LeafError,
  makeToneRuntime,
  Tone,
  type ToneRuntime,
} from "./audio-renderer";
import { useRackStore } from "./stores/rack";

// An offline context renders into a buffer instead of the speakers, and its
// clock stands still, so scheduled values can be read back at fixed times.
ToneJs.setContext(
  new ToneJs.OfflineContext(new OfflineAudioContext(2, 44100, 44100)),
);

const initial = useRackStore.getState();
const store = () => useRackStore.getState();

const defined = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`expected ${what}`);
  return value;
};

// The sample rack: an AMSynth patched into the Destination, both directly
// under the root. The store's own runtime stays the no-op one, so building
// the rack here touches no audio; each test drives the runtime itself.
const buildSampleRack = () => {
  const synth = defined(
    store().addCatalogueBlock("instruments", "AMSynth"),
    "AMSynth",
  );
  const destination = defined(
    store().addCatalogueBlock("output", "Destination"),
    "Destination",
  );
  const patch = defined(
    store().connectJacks(`${synth}:out`, `${destination}:in`),
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
  useRackStore.setState(initial, true);
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
  store().setParamValue(param(synth, "volume"), -6);
  store().setParamValue(param(synth, "oscillator.type"), "square");
  store().setParamValue(param(synth, "envelope.attack"), 0.2);
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
  const blank = defined(store().addBlock("leaf"), "blank leaf");
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
  const blank = defined(store().addBlock("leaf"), "blank leaf");
  const broken = defined(
    store().connectJacks(`${synth}:out`, `${blank}:in`),
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

  store().setParamValue(param(synth, "volume"), -12);
  await Effect.runPromise(runtime.updateParam(param(synth, "volume")));

  const after = await nodeOf(runtime, synth);
  expect(after).toBe(before);
  expect(after.volume.value).toBeCloseTo(-12);
});

test("updateParam replaces scheduled automation and keeps the value", async () => {
  const { synth } = buildSampleRack();
  const volume = param(synth, "volume");
  store().setParamValue(volume, -12);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const node = await nodeOf(runtime, synth);

  const eventId = defined(
    store().addAutomation(volume, {
      method: "setValueAtTime",
      value: -20,
      time: "1",
    }),
    "automation",
  );
  await Effect.runPromise(runtime.updateParam(volume));

  expect(node.volume.getValueAtTime(0.5)).toBeCloseTo(-12);
  expect(node.volume.getValueAtTime(2)).toBeCloseTo(-20);

  store().removeAutomation(volume, eventId);
  await Effect.runPromise(runtime.updateParam(volume));

  expect(node.volume.getValueAtTime(2)).toBeCloseTo(-12);
});

test("automation times count from when the param is applied", async () => {
  const { synth } = buildSampleRack();
  const volume = param(synth, "volume");
  store().setParamValue(volume, -12);
  defined(
    store().addAutomation(volume, {
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
  useRackStore.setState({
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
  store().setParamValue(param(synth, "oscillator.width"), 0.7);
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);

  store().setParamValue(param(synth, "oscillator.type"), "pulse");
  await Effect.runPromise(runtime.updateParam(param(synth, "oscillator.type")));

  const node = await nodeOf(runtime, synth);
  expect(node.oscillator.type).toBe("pulse");
  expect(node.oscillator.width?.value).toBeCloseTo(0.7);
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
    store().addCatalogueBlock("output", "Destination"),
    "second Destination",
  );
  defined(store().connectJacks(`${synth}:out`, `${second}:in`), "second patch");
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

test("runLeafMethod on a failed leaf fails with that leaf's error", async () => {
  const { synth } = buildSampleRack();
  // Swap the synth's code for one that fails, as a broken leaf would.
  const block = store().blocks[synth];
  if (block?.type !== "leaf") throw new Error("expected a leaf");
  const failing = Effect.fail(new LeafError({ message: "broken synth" }));
  useRackStore.setState({
    blocks: { ...store().blocks, [synth]: { ...block, code: () => failing } },
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
  const group = defined(store().addBlock("tree"), "group");
  const synth = defined(
    store().addCatalogueBlock("instruments", "AMSynth"),
    "AMSynth",
  );
  const { blocks } = store();
  const root = blocks.root;
  const groupBlock = blocks[group];
  if (root?.type !== "tree" || groupBlock?.type !== "tree") {
    throw new Error("expected trees");
  }
  useRackStore.setState({
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
