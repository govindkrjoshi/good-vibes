import { Effect, Exit } from "effect";
import { expect, test } from "vitest";
import { initialRackState } from "../rack/store";
import type { RackState } from "../rack/model";
import { makeSandboxClient, type HostPort } from "./client";
import type { CommandError, Request } from "./protocol";

// A port that keeps what it was sent, and can be answered by hand.
const fakePort = () => {
  const sent: Request[] = [];
  const port: HostPort & {
    readonly sent: Request[];
    reply: (reply: unknown) => void;
    closed: boolean;
  } = {
    sent,
    closed: false,
    onmessage: null,
    postMessage: (message) => sent.push(message),
    close() {
      this.closed = true;
    },
    reply(reply) {
      this.onmessage?.({ data: reply } as MessageEvent<unknown>);
    },
  };
  return port;
};

const setup = () => {
  let state: RackState = initialRackState;
  const client = makeSandboxClient(() => state);
  return {
    client,
    setState: (next: Partial<RackState>) => {
      state = { ...state, ...next };
    },
  };
};

const result = (id: number, error?: CommandError) =>
  error === undefined ? { type: "result", id } : { type: "result", id, error };

test("holds commands until a frame is connected, then sends them in order", async () => {
  const { client } = setup();
  const port = fakePort();

  const added = Effect.runPromise(client.runtime.addBlock("synth"));
  const rendered = Effect.runPromise(client.runtime.render);
  client.connect(port);

  expect(port.sent.map((request) => request.command)).toEqual([
    { name: "addBlock", blockId: "synth" },
    { name: "render" },
  ]);
  port.reply(result(port.sent[0]!.id));
  port.reply(result(port.sent[1]!.id));
  await expect(added).resolves.toBeUndefined();
  await expect(rendered).resolves.toBeUndefined();
});

test("sends the whole rack once, then only what changed", async () => {
  const { client, setState } = setup();
  const port = fakePort();
  client.connect(port);

  void Effect.runPromise(client.runtime.render);
  setState({ transport: { bpm: 90 } });
  void Effect.runPromise(client.runtime.updateTransport);
  void Effect.runPromise(client.runtime.stop);

  expect(Object.keys(port.sent[0]!.changes)).toEqual(
    Object.keys(initialRackState),
  );
  expect(port.sent[1]!.changes).toEqual({ transport: { bpm: 90 } });
  expect(port.sent[2]!.changes).toEqual({});
});

test("fails a command with the error the frame reported", async () => {
  const { client } = setup();
  const port = fakePort();
  client.connect(port);

  const leaf = Effect.runPromiseExit(client.runtime.updateParam("p"));
  const patch = Effect.runPromiseExit(client.runtime.addPatch("x"));
  port.reply(result(0, { _tag: "LeafError", message: "No param p" }));
  port.reply(result(1, { _tag: "PatchError", message: "missing a jack" }));

  expect(await leaf).toEqual(
    Exit.fail(
      expect.objectContaining({ _tag: "LeafError", message: "No param p" }),
    ),
  );
  expect(await patch).toEqual(
    Exit.fail(
      expect.objectContaining({
        _tag: "PatchError",
        message: "missing a jack",
      }),
    ),
  );
});

test("ignores anything from the frame that is not a reply it is owed", async () => {
  const { client } = setup();
  const port = fakePort();
  const audio: unknown[] = [];
  client.onAudio((state) => audio.push(state));
  client.connect(port);

  let done = false;
  void Effect.runPromise(client.runtime.stop).then(() => (done = true));
  port.reply({ type: "result", id: "0" });
  port.reply({ type: "result", id: 99 });
  port.reply({ type: "audio", state: "loud" });
  port.reply("result");
  await Promise.resolve();

  expect(done).toBe(false);
  expect(audio).toEqual([]);

  port.reply({ type: "audio", state: "suspended" });
  port.reply(result(0));
  await new Promise((resolve) => setTimeout(resolve));
  expect(audio).toEqual(["suspended"]);
  expect(done).toBe(true);
});

test("a new frame is sent the whole rack, and the old one's debts fail", async () => {
  const { client } = setup();
  const first = fakePort();
  const second = fakePort();
  client.connect(first);

  const owed = Effect.runPromiseExit(client.runtime.addBlock("synth"));
  client.connect(second);
  void Effect.runPromise(client.runtime.render);

  expect(first.closed).toBe(true);
  expect(first.onmessage).toBeNull();
  expect(Exit.isFailure(await owed)).toBe(true);
  expect(Object.keys(second.sent[0]!.changes)).toEqual(
    Object.keys(initialRackState),
  );
});
