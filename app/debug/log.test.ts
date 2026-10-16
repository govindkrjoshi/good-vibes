// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Effect, Exit, Scope } from "effect";
import * as ToneJs from "tone";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CATALOGUE } from "../catalogue";
import {
  edits,
  onDispatch,
  onRackWork,
  rackEnvelope,
  rackStore,
  type RackMsg,
  type RackTemplate,
} from "../rack";
import { makeSandboxClient } from "../sandbox/client";
import { makeRackHost } from "../sandbox/host";
import { initialSandboxStatus, sandboxStatus } from "../sandbox/status";
import {
  byChain,
  byRevision,
  makeDebugLog,
  record,
  type DebugLog,
} from "./log";

ToneJs.setContext(
  new ToneJs.OfflineContext(new OfflineAudioContext(2, 44100, 44100)),
);

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const initial = rackStore.getState();
let log: DebugLog;
let scope: Scope.Closeable;
let channel: MessageChannel;
let stop: () => void;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const send = (msg: RackMsg) => rackStore.getState().dispatch(rackEnvelope(msg));

beforeEach(() => {
  rackStore.setState(initial, true);
  sandboxStatus.setState(initialSandboxStatus, true);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  log = makeDebugLog();
  stop = onDispatch((dispatched) =>
    record(log, { at: 0, source: "rack", ...dispatched }),
  );
  scope = Effect.runSync(Scope.make());
  const client = Effect.runSync(
    makeSandboxClient(
      {
        getState: rackStore.getState,
        subscribe: rackStore.subscribe,
        onWork: onRackWork,
      },
      { onDebug: (event) => record(log, { at: 0, source: "sandbox", event }) },
    ).pipe(Scope.provide(scope)),
  );
  const host = makeRackHost(ToneJs);
  channel = new MessageChannel();
  host.attach(channel.port2);
  client.connect(channel.port1);
});

afterEach(async () => {
  stop();
  await Effect.runPromise(Scope.close(scope, Exit.void));
  channel.port1.close();
  channel.port2.close();
  vi.restoreAllMocks();
});

test("follows each revision to its commands, the frame's answers and errors", async () => {
  send(edits.addTemplate(template("instruments", "AMSynth"), "synth"));
  send(edits.addBlock("leaf", "blank"));
  await settle();
  await settle();

  const [blank, synth] = byRevision(log.getState().entries);
  expect(synth).toMatchObject({
    rev: 1,
    messages: [{ origin: "user", msg: "AddTemplate", outcome: "Committed" }],
    commands: [{ name: "addBlock", target: "block synth", answer: "ok" }],
    errors: [],
  });
  expect(blank).toMatchObject({
    rev: 2,
    commands: [
      { name: "addBlock", target: "block blank", answer: "LeafThrew" },
    ],
    errors: ["build blank: LeafThrew"],
  });
});

test("shows edits folded into one batch, and edits with no sandbox effect", async () => {
  send(edits.addTemplate(template("instruments", "AMSynth"), "synth"));
  // While that batch is in flight:
  send(edits.setParamValue("synth:param:volume", -6));
  send(edits.setTransport(90));
  send(edits.addBlock("leaf", "brief"));
  send(edits.removeBlocks(["brief"]));
  await settle();
  await settle();

  const views = new Map(
    byRevision(log.getState().entries).map((view) => [view.rev, view]),
  );
  // The param and the tempo went in one batch.
  expect(views.get(2)?.commands.map((command) => command.name)).toEqual([
    "updateParam",
  ]);
  expect(views.get(2)?.coalescedWith).toEqual([3]);
  expect(views.get(3)?.coalescedWith).toEqual([2]);
  // Added and removed before the frame was sent either.
  expect(views.get(4)?.commands).toEqual([]);
  expect(views.get(5)?.commands).toEqual([]);
});

test("follows each chain's turns and what each check after them found", () => {
  const chainLog = makeDebugLog();
  const turn = { turnId: "chain-1", chainId: "chain-1" };
  const fix = { turnId: "chain-1-fix-1", chainId: "chain-1" };
  for (const event of [
    { _tag: "TurnStarted", turn, kind: "prompt" },
    { _tag: "TurnEnded", turn, ok: true },
    {
      _tag: "Checked",
      chainId: "chain-1",
      round: 1,
      found: { _tag: "Errors", count: 2, fingerprint: "a", prompt: "Fix" },
    },
    { _tag: "TurnStarted", turn: fix, kind: "fixup" },
    { _tag: "TurnEnded", turn: fix, ok: true },
    { _tag: "Checked", chainId: "chain-1", round: 2, found: { _tag: "Clean" } },
  ] as const)
    record(chainLog, { at: 0, source: "agent", event });

  expect(byChain(chainLog.getState().entries)).toEqual([
    {
      chainId: "chain-1",
      turns: [
        { turnId: "chain-1", kind: "prompt", ok: true },
        { turnId: "chain-1-fix-1", kind: "fixup", ok: true },
      ],
      checks: [
        { round: 1, found: "2 errors", fingerprint: "a" },
        { round: 2, found: "Clean" },
      ],
    },
  ]);
});

test("keeps only the newest entries", () => {
  const small = makeDebugLog();
  for (let i = 0; i < 5; i += 1)
    record(small, { at: i, source: "agent", event: { _tag: "Cancelled" } }, 3);

  expect(small.getState().entries.map((entry) => entry.at)).toEqual([2, 3, 4]);
});
