// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Effect, Exit } from "effect";
import * as ToneJs from "tone";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CATALOGUE } from "../catalogue";
import { rackStore } from "../rack/store";
import type { RackTemplate } from "../rack/model";
import { makeSandboxClient } from "./client";
import { makeRackHost } from "./host";

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

// The app's store, wired to a host over a real MessageChannel, as the
// provider wires it to the frame.
let channel: MessageChannel;
let host: ReturnType<typeof makeRackHost>;
let started = 0;

beforeEach(() => {
  rackStore.setState(initial, true);
  started = 0;
  channel = new MessageChannel();
  host = makeRackHost(ToneJs, { startAudio: () => (started += 1) });
  host.attach(channel.port2);
  const client = makeSandboxClient(store);
  client.connect(channel.port1);
  rackStore.setState({ runtime: client.runtime });
});

afterEach(() => {
  channel.port1.close();
  channel.port2.close();
});

const rendered = () => Effect.runPromise(host.runtime.rendered);

const leafExit = async (blockId: string) => {
  const block = (await rendered()).blocks.get(blockId);
  if (block?.kind !== "leaf") throw new Error(`${blockId} is not rendered`);
  return block.exit;
};

test("renders the app's rack in the host, starting audio as it does", async () => {
  const synth = store().addTemplate(template("instruments", "AMSynth")) ?? "";
  const destination =
    store().addTemplate(template("output", "Destination")) ?? "";
  const patch = store().connectJacks(`${synth}:out`, `${destination}:in`) ?? "";

  await Effect.runPromise(store().runtime.render);

  expect(started).toBe(1);
  const exit = await leafExit(synth);
  expect(Exit.isSuccess(exit) && exit.value).toBeInstanceOf(ToneJs.AMSynth);
  expect(Exit.isSuccess((await rendered()).patches.get(patch)!.exit)).toBe(
    true,
  );
});

test("carries each later change over without a new render", async () => {
  const synth = store().addTemplate(template("instruments", "AMSynth")) ?? "";
  await Effect.runPromise(store().runtime.render);
  const before = await leafExit(synth);

  store().setParamValue(`${synth}:param:volume`, -12);
  await Effect.runPromise(store().runtime.updateParam(`${synth}:param:volume`));

  const after = await leafExit(synth);
  expect(after).toBe(before);
  if (!Exit.isSuccess(after)) throw new Error("synth did not render");
  expect((after.value as ToneJs.AMSynth).volume.value).toBeCloseTo(-12);
  expect(host.state().values[`${synth}:param:volume`]).toBe(-12);
  expect(started).toBe(1);
});

test("sends back why a leaf failed, without failing the render", async () => {
  const blank = store().addBlock("leaf") ?? "";
  await Effect.runPromise(store().runtime.render);

  const exit = await Effect.runPromiseExit(store().runtime.addBlock(blank));

  expect(exit).toEqual(
    Exit.fail(
      expect.objectContaining({
        _tag: "LeafError",
        message: "Leaf has no code",
      }),
    ),
  );
});

test("drops a message that is not a request, and answers the next", async () => {
  const other = new MessageChannel();
  const replies: unknown[] = [];
  other.port1.onmessage = (event) => replies.push(event.data);
  host.attach(other.port2);

  other.port1.postMessage({ type: "request", id: 1, command: "render" });
  other.port1.postMessage({
    type: "request",
    id: 2,
    changes: {},
    command: { name: "stop" },
  });
  await expect.poll(() => replies).toEqual([{ type: "result", id: 2 }]);
  other.port1.close();
  other.port2.close();
});
