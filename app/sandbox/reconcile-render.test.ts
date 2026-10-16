// Tone.js needs the Web Audio globals, which node lacks; this installs a
// pure JavaScript implementation. It has to load before Tone does.
import "web-audio-api/polyfill";
import { Cause, Effect, Exit } from "effect";
import * as ToneJs from "tone";
import { expect, test } from "vitest";
import { CATALOGUE } from "../catalogue";
import type { RackMsg } from "../rack/messages";
import { Tone, type RackTemplate } from "../rack/model";
import { initialRackMeta, reduce, type RackCore } from "../rack/reduce";
import {
  makeToneRuntime,
  type RenderedRackState,
  type ToneRuntime,
} from "../rack/renderer";
import { initialRackState } from "../rack/store";
import { random, randomMsg } from "../testing/rack-messages";
import { runCommand } from "./host";
import { commandsFor, emptySnapshot, type Snapshot } from "./reconcile";

// Checks reconcile against the real renderer: a frame that only ever gets the
// commands reconcile works out ends up with the same graph as one that
// renders the same rack from scratch.

ToneJs.setContext(
  new ToneJs.OfflineContext(new OfflineAudioContext(2, 44100, 44100)),
);

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const empty: RackCore = { ...initialRackState, ...initialRackMeta };

const runtimeFor = (getState: () => RackCore): ToneRuntime =>
  Effect.runSync(
    makeToneRuntime(getState).pipe(Effect.provideService(Tone, ToneJs)),
  );

const codeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return "ok";
  const error = Cause.squash(exit.cause) as { code?: string };
  return error.code ?? "failed";
};

// What a graph built and what failed, without the root, which a full render
// records and incremental commands never touch.
const summary = (rendered: RenderedRackState) => ({
  blocks: [...rendered.blocks]
    .filter(([id]) => id !== "root")
    .map(([id, block]) => [
      id,
      block.kind === "leaf" ? codeOf(block.exit) : "tree",
    ])
    .sort(),
  patches: [...rendered.patches]
    .map(([id, patch]) => [id, codeOf(patch.exit)])
    .sort(),
  events: [...rendered.events]
    .map(([id, event]) => [id, codeOf(event.exit)])
    .sort(),
});

// A frame that is only ever sent reconcile's commands, with failures read
// back off its graph as the ledger will read them off the frame's answers.
const incrementalFrame = () => {
  let state: RackCore = empty;
  let sent: Snapshot = emptySnapshot;
  const runtime = runtimeFor(() => state);
  const failed = (kind: string, id: string) => {
    const rendered = Effect.runSync(runtime.rendered);
    const block = rendered.blocks.get(id);
    const exits: Record<string, Exit.Exit<unknown, unknown> | undefined> = {
      build: block?.kind === "leaf" ? block.exit : undefined,
      connect: rendered.patches.get(id)?.exit,
      schedule: rendered.events.get(id)?.exit,
    };
    const exit = exits[kind];
    return exit !== undefined && Exit.isFailure(exit);
  };

  return {
    runtime,
    sync: async (next: RackCore) => {
      const planned = commandsFor(sent, next, failed);
      state = next;
      for (const { command } of planned)
        await Effect.runPromiseExit(runCommand(runtime, command));
      sent = next;
      return planned;
    },
  };
};

const freshRender = async (state: RackCore) => {
  const runtime = runtimeFor(() => state);
  await Effect.runPromise(runtime.render);
  return summary(await Effect.runPromise(runtime.rendered));
};

let envelopes = 0;
const apply = (state: RackCore, msg: RackMsg) =>
  reduce(state, { id: `env-${envelopes++}`, origin: "user", msg }).state;

test("following reconcile builds the same graph as rendering from scratch", async () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 12; seed += 1) {
    const rand = random(seed);
    const frame = incrementalFrame();
    let state = empty;
    for (let step = 1; step <= 40; step += 1) {
      state = apply(state, randomMsg(state, rand));
      await frame.sync(state);
      if (step % 5 !== 0) continue;
      const expected = await freshRender(state);
      expect(
        summary(await Effect.runPromise(frame.runtime.rendered)),
        `seed ${seed} step ${step}`,
      ).toEqual(expected);
      for (const [kind, entries] of Object.entries(expected))
        for (const [, code] of entries) seen.add(`${kind} ${code}`);
    }
  }
  // The sequences have to reach failures and what hangs off them.
  expect([...seen].sort()).toEqual(
    expect.arrayContaining([
      "blocks LeafThrew",
      "blocks ok",
      "events ok",
      "patches EndpointFailed",
      "patches ok",
    ]),
  );
});

// A leaf whose node will not take the mode "bad", so it fails to build
// until its param changes.
const moody: RackTemplate = {
  id: "test:moody",
  name: "Moody",
  type: "leaf",
  isRoot: false,
  jackIds: [],
  params: {
    params: {
      mode: { kind: "text", name: "Mode", path: ["mode"], defaultValue: "bad" },
    },
  },
  code: `Effect.gen(function* () {
  const tone = yield* Tone;
  const node = new tone.Gain();
  let mode = "ok";
  Object.defineProperty(node, "mode", {
    get: () => mode,
    set: (value) => {
      if (value === "bad") throw new Error("not in that mood");
      mode = value;
    },
  });
  return node;
})`,
};

test("a leaf that failed on a param is rebuilt when the param changes, and its patch comes back", async () => {
  const frame = incrementalFrame();
  let state = empty;
  for (const msg of [
    { _tag: "AddTemplate", blockId: "moody", template: moody },
    {
      _tag: "AddTemplate",
      blockId: "out",
      template: template("output", "Destination"),
    },
    { _tag: "ConnectJacks", patchId: "p", from: "moody:out", to: "out:in" },
  ] satisfies RackMsg[])
    state = apply(state, msg);
  await frame.sync(state);

  expect(summary(await Effect.runPromise(frame.runtime.rendered))).toEqual({
    blocks: [
      ["moody", "ParamRejected"],
      ["out", "ok"],
    ],
    patches: [["p", "EndpointFailed"]],
    events: [],
  });

  state = apply(state, {
    _tag: "SetParamValue",
    paramId: "moody:param:mode",
    value: "calm",
  });
  const planned = await frame.sync(state);

  expect(planned.map(({ command }) => command.name)).toEqual([
    "addBlock",
    "addPatch",
  ]);
  expect(summary(await Effect.runPromise(frame.runtime.rendered))).toEqual({
    blocks: [
      ["moody", "ok"],
      ["out", "ok"],
    ],
    patches: [["p", "ok"]],
    events: [],
  });
  expect(summary(await Effect.runPromise(frame.runtime.rendered))).toEqual(
    await freshRender(state),
  );
});
