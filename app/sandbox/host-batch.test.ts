// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Effect, Exit } from "effect";
import * as ToneJs from "tone";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CATALOGUE } from "../catalogue";
import type { RackTemplate } from "../rack/model";
import { rackStore } from "../rack/store";
import { makeRackHost } from "./host";
import {
  rackChanges,
  type Batch,
  type BatchResult,
  type Command,
  type Playback,
} from "./protocol";
import { rackActions } from "../testing/rack-actions";

const rack = rackActions(rackStore);

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

let channel: MessageChannel;
let host: ReturnType<typeof makeRackHost>;
let replies: unknown[];
let sent: ReturnType<typeof store> | undefined;
let batchId: number;

beforeEach(() => {
  rackStore.setState(initial, true);
  channel = new MessageChannel();
  host = makeRackHost(ToneJs);
  host.attach(channel.port2);
  replies = [];
  channel.port1.onmessage = (event) => replies.push(event.data);
  sent = undefined;
  batchId = 0;
});

afterEach(() => {
  channel.port1.close();
  channel.port2.close();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const until = async <T>(find: () => T | undefined): Promise<T> => {
  for (let tries = 0; tries < 200; tries += 1) {
    const found = find();
    if (found !== undefined) return found;
    await settle();
  }
  throw new Error("no reply came");
};

// Sends the rack as it now stands and the commands, numbered from `first`,
// and waits for the frame's answer.
const sendBatch = async (
  commands: readonly Command[],
  { gen = 1, first = 1 } = {},
): Promise<BatchResult> => {
  batchId += 1;
  const batch: Batch = {
    v: 2,
    type: "batch",
    gen,
    batchId,
    changes: rackChanges(sent, store()),
    commands: commands.map((command, index) => ({
      cmdId: first + index,
      command,
    })),
  };
  sent = store();
  channel.port1.postMessage(batch);
  const id = batchId;
  return until(() =>
    replies.find(
      (reply): reply is BatchResult =>
        (reply as BatchResult).type === "batchResult" &&
        (reply as BatchResult).batchId === id,
    ),
  );
};

const synthAndDestination = () => {
  const synth = rack.addTemplate(template("instruments", "AMSynth")) ?? "";
  const destination = rack.addTemplate(template("output", "Destination")) ?? "";
  const patch = rack.connectJacks(`${synth}:out`, `${destination}:in`) ?? "";
  return { synth, destination, patch, riff: `${synth}:event:riff` };
};

test("runs a batch's commands in order and answers once, for each command", async () => {
  const { synth, destination, patch, riff } = synthAndDestination();

  const result = await sendBatch([
    { name: "addBlock", blockId: synth },
    { name: "addBlock", blockId: destination },
    { name: "addPatch", patchId: patch },
    // Only works once the synth has been built, earlier in the batch.
    { name: "updateParam", paramId: `${synth}:param:volume` },
  ]);
  await settle();

  expect(result).toEqual({
    v: 2,
    type: "batchResult",
    gen: 1,
    batchId: 1,
    results: [
      {
        cmdId: 1,
        entities: [
          { entity: "block", id: synth },
          { entity: "event", id: riff },
        ],
      },
      { cmdId: 2, entities: [{ entity: "block", id: destination }] },
      { cmdId: 3, entities: [{ entity: "patch", id: patch }] },
      { cmdId: 4, entities: [] },
    ],
  });
  expect(
    replies.filter((reply) => (reply as BatchResult).type === "batchResult"),
  ).toHaveLength(1);
});

test("reports a failed leaf, and what hangs off it, with codes", async () => {
  const { synth } = synthAndDestination();
  const blank = rack.addBlock("leaf") ?? "";
  const patch = rack.connectJacks(`${synth}:out`, `${blank}:in`) ?? "";

  const result = await sendBatch([
    { name: "addBlock", blockId: synth },
    { name: "addBlock", blockId: blank },
    { name: "addPatch", patchId: patch },
    { name: "updateParam", paramId: "nothing" },
  ]);

  expect(result.results[1]?.entities).toEqual([
    {
      entity: "block",
      id: blank,
      failure: { code: "LeafThrew", message: "Leaf has no code" },
    },
  ]);
  expect(result.results[2]).toEqual({
    cmdId: 3,
    failure: expect.objectContaining({ code: "EndpointFailed" }),
    entities: [
      {
        entity: "patch",
        id: patch,
        failure: expect.objectContaining({ code: "EndpointFailed" }),
      },
    ],
  });
  expect(result.results[3]?.failure).toEqual({
    code: "Missing",
    message: "No param nothing",
  });
});

test("reports what a command took away", async () => {
  const { synth, riff } = synthAndDestination();
  await sendBatch([{ name: "addBlock", blockId: synth }]);
  rack.removeBlocks([synth]);

  const result = await sendBatch(
    [
      { name: "deleteEvent", eventId: riff },
      { name: "deleteBlock", blockId: synth },
    ],
    { first: 2 },
  );

  expect(result.results).toEqual([
    { cmdId: 2, entities: [{ entity: "event", id: riff, removed: true }] },
    { cmdId: 3, entities: [{ entity: "block", id: synth, removed: true }] },
  ]);
});

const sequenceOf = async (eventId: string) => {
  const event = (await Effect.runPromise(host.runtime.rendered)).events.get(
    eventId,
  );
  if (event === undefined || !Exit.isSuccess(event.exit))
    throw new Error(`${eventId} did not render`);
  return event.exit.value as unknown as ToneJs.Sequence;
};

test("a call that fails while playing names the command that scheduled it", async () => {
  const { synth, riff } = synthAndDestination();
  await sendBatch([{ name: "addBlock", blockId: synth }], { gen: 3, first: 7 });
  const block = (await Effect.runPromise(host.runtime.rendered)).blocks.get(
    synth,
  );
  if (block?.kind !== "leaf" || !Exit.isSuccess(block.exit))
    throw new Error("synth did not build");
  vi.spyOn(
    block.exit.value as unknown as ToneJs.AMSynth,
    "triggerAttackRelease",
  ).mockImplementation(() => {
    throw new Error("bad note");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const old = await sequenceOf(riff);

  // The offline clock never moves, so fire a step by hand.
  old.callback(1, "C4");
  const first = await until(() =>
    replies.find(
      (reply): reply is Playback => (reply as Playback).type === "playback",
    ),
  );
  await sendBatch([{ name: "updateEvent", eventId: riff }], {
    gen: 3,
    first: 8,
  });
  replies = [];
  old.callback(1, "C4");
  (await sequenceOf(riff)).callback(1, "C4");
  const second = await until(() =>
    replies.find(
      (reply): reply is Playback => (reply as Playback).type === "playback",
    ),
  );
  await settle();

  expect(first).toEqual({
    v: 2,
    type: "playback",
    gen: 3,
    eventId: riff,
    scheduleCmdId: 7,
    message: expect.stringContaining("bad note"),
  });
  // The old schedule's failure is not reported; the new one names cmd 8.
  expect(second.scheduleCmdId).toBe(8);
  expect(
    replies.filter((reply) => (reply as Playback).type === "playback"),
  ).toHaveLength(1);
  warn.mockRestore();
});

test("drops a batch that does not fit the protocol", async () => {
  channel.port1.postMessage({ v: 2, type: "batch", gen: 1, batchId: 1 });
  await settle();
  await settle();

  expect(replies).toEqual([]);
});
