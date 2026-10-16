// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Effect, Exit, Scope } from "effect";
import * as ToneJs from "tone";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CATALOGUE } from "../catalogue";
import type { RackTemplate } from "../rack/model";
import { onRackWork, rackStore } from "../rack/store";
import { makeSandboxClient, type SandboxClient } from "./client";
import { makeRackHost } from "./host";
import { initialSandboxStatus, sandboxStatus } from "./status";

// The app's store and the frame's host, wired as the provider wires them:
// the client drives a real host over a real MessageChannel.

ToneJs.setContext(
  new ToneJs.OfflineContext(new OfflineAudioContext(2, 44100, 44100)),
);

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const initial = rackStore.getState();
const store = () => rackStore.getState();
const rack = {
  getState: rackStore.getState,
  subscribe: rackStore.subscribe,
  onWork: onRackWork,
};

let host: ReturnType<typeof makeRackHost>;
let started: number;
const scopes: Scope.Closeable[] = [];
const channels: MessageChannel[] = [];

beforeEach(() => {
  rackStore.setState(initial, true);
  sandboxStatus.setState(initialSandboxStatus, true);
  started = 0;
  host = makeRackHost(ToneJs, { startAudio: () => (started += 1) });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const scope of scopes.splice(0))
    await Effect.runPromise(Scope.close(scope, Exit.void));
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  vi.restoreAllMocks();
});

// A client in a scope of its own, connected to the host over a new channel.
const connected = (): { client: SandboxClient; scope: Scope.Closeable } => {
  const scope = Effect.runSync(Scope.make());
  scopes.push(scope);
  const client = Effect.runSync(
    makeSandboxClient(rack, { tickMs: 20 }).pipe(Scope.provide(scope)),
  );
  const channel = new MessageChannel();
  channels.push(channel);
  host.attach(channel.port2);
  client.connect(channel.port1);
  return { client, scope };
};

const settled = (client: SandboxClient) =>
  Effect.runPromise(client.barrier(2000));

const rendered = () => Effect.runPromise(host.runtime.rendered);

const leafOk = async (blockId: string) => {
  const block = (await rendered()).blocks.get(blockId);
  return block?.kind === "leaf" && Exit.isSuccess(block.exit);
};

const buildRiff = () => {
  const synth = store().addTemplate(template("instruments", "AMSynth")) ?? "";
  const out = store().addTemplate(template("output", "Destination")) ?? "";
  const patch = store().connectJacks(`${synth}:out`, `${out}:in`) ?? "";
  return { synth, out, patch, riff: `${synth}:event:riff` };
};

test("builds the app's rack in the frame as it is edited", async () => {
  const { client } = connected();
  const { synth, out, patch } = buildRiff();

  expect(await settled(client)).toEqual({ _tag: "Settled" });
  expect(await leafOk(synth)).toBe(true);
  expect(await leafOk(out)).toBe(true);
  const connection = (await rendered()).patches.get(patch);
  expect(connection !== undefined && Exit.isSuccess(connection.exit)).toBe(
    true,
  );
  expect(sandboxStatus.getState()).toMatchObject({
    connection: { _tag: "Connected", gen: 1 },
    errors: {},
    pending: 0,
    settledSeq: store().workSeq,
  });
});

test("sends a rack built before the frame connected", async () => {
  const { synth } = buildRiff();
  const { client } = connected();

  expect(await settled(client)).toEqual({ _tag: "Settled" });
  expect(await leafOk(synth)).toBe(true);
});

test("Run starts audio in the frame after the edits before it", async () => {
  const { client } = connected();
  const { synth } = buildRiff();
  store().run();

  expect(await settled(client)).toEqual({ _tag: "Settled" });
  expect(started).toBe(1);
  expect(await leafOk(synth)).toBe(true);
});

test("shows a leaf that failed to build, and waits for a retry of it", async () => {
  const { client } = connected();
  const blank = store().addBlock("leaf") ?? "";
  await settled(client);

  expect(sandboxStatus.getState().errors[`build:${blank}`]).toMatchObject({
    code: "LeafThrew",
    message: "Leaf has no code",
  });
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("Leaf has no code"),
  );

  const before = store().workSeq;
  store().dispatch({
    id: "retry",
    origin: "user",
    msg: { _tag: "Retry", entity: "block", entityId: blank },
  });
  expect(store().workSeq).toBe(before + 1);
  expect(await settled(client)).toEqual({ _tag: "Settled" });
  expect(sandboxStatus.getState().settledSeq).toBe(before + 1);
});

test("hands a playing sequence its new steps without rebuilding it", async () => {
  const { client } = connected();
  const { riff } = buildRiff();
  store().run();
  await settled(client);
  const sequence = (await rendered()).events.get(riff);

  store().setEventSteps(riff, ["A3", "B3"]);
  await settled(client);

  const after = (await rendered()).events.get(riff);
  expect(after).toBe(sequence);
  if (after === undefined || !Exit.isSuccess(after.exit))
    throw new Error("riff did not render");
  expect((after.exit.value as unknown as ToneJs.Sequence).events).toEqual([
    "A3",
    "B3",
  ]);
});

test("a new connection to the same frame clears what it held from before", async () => {
  const first = connected();
  const { synth } = buildRiff();
  await settled(first.client);
  await Effect.runPromise(Scope.close(first.scope, Exit.void));

  // Removed while nothing was connected, as across a remount.
  store().removeBlocks([synth]);
  const second = connected();
  await settled(second.client);

  expect((await rendered()).blocks.has(synth)).toBe(false);
});

test("closing the client tells waiting barriers the frame is gone, and forgets its status", async () => {
  const { client, scope } = connected();
  buildRiff();
  const waiting = Effect.runPromise(client.barrier(10_000));

  await Effect.runPromise(Scope.close(scope, Exit.void));

  expect(await waiting).toEqual({ _tag: "Disconnected" });
  expect(sandboxStatus.getState()).toEqual(initialSandboxStatus);
});

test("passes on how audio is doing in the frame", async () => {
  connected();

  host.report("suspended");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(sandboxStatus.getState().audio).toBe("suspended");
});
