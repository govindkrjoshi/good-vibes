import { expect, test } from "vitest";
import { CATALOGUE } from "../catalogue";
import type { RackMsg } from "../rack/messages";
import type { RackTemplate } from "../rack/model";
import { initialRackMeta, reduce, type RackCore } from "../rack/reduce";
import { initialRackState } from "../rack/store";
import { deepFreeze } from "../testing/freeze";
import {
  initialLedger,
  livenessMs,
  step,
  type BarrierResult,
  type Dropped,
  type ErrorChange,
  type Ledger,
  type LedgerInput,
} from "./ledger";
import type { Batch, CommandResult, Failure, Playback } from "./protocol";

// The ledger's contract (C1 to C6 in the migration plan), one rule per test.
// A small world drives it: a store reduced from messages, as the client will
// feed it, and a frame that answers batches the way the host does.

const template = (category: string, entry: string): RackTemplate => {
  const found = CATALOGUE[category]?.[entry]?.rack;
  if (found === undefined) throw new Error(`no ${category}/${entry}`);
  return found;
};

const synth: RackMsg = {
  _tag: "AddTemplate",
  blockId: "synth",
  template: template("instruments", "AMSynth"),
};
const destination: RackMsg = {
  _tag: "AddTemplate",
  blockId: "out",
  template: template("output", "Destination"),
};
const connect: RackMsg = {
  _tag: "ConnectJacks",
  patchId: "p",
  from: "synth:out",
  to: "out:in",
};
const volume = "synth:param:volume";
const riff = "synth:event:riff";
const setVolume = (value: number): RackMsg => ({
  _tag: "SetParamValue",
  paramId: volume,
  value,
});

const fail = (code: Failure["code"], message: string = code): Failure => ({
  code,
  message,
});

// How the host answers a command when it works, or fails with `failure`.
const answer = (
  cmdId: number,
  command: Batch["commands"][number]["command"],
  failure?: Failure,
): CommandResult => {
  const entity = (
    kind: "block" | "patch" | "event",
    id: string,
    removed = false,
  ): CommandResult => ({
    cmdId,
    ...(failure === undefined ? {} : { failure }),
    entities: [
      {
        entity: kind,
        id,
        ...(removed ? { removed: true } : {}),
        ...(failure === undefined ? {} : { failure }),
      },
    ],
  });
  switch (command.name) {
    case "addBlock":
      return entity("block", command.blockId);
    case "deleteBlock":
      return entity("block", command.blockId, true);
    case "addPatch":
      return entity("patch", command.patchId);
    case "deletePatch":
      return entity("patch", command.patchId, true);
    case "updateEvent":
    case "updateEventLive":
      return entity("event", command.eventId);
    case "deleteEvent":
      return entity("event", command.eventId, true);
    default:
      return {
        cmdId,
        ...(failure === undefined ? {} : { failure }),
        entities: [],
      };
  }
};

const world = () => {
  let envelopes = 0;
  let state: RackCore = deepFreeze({ ...initialRackState, ...initialRackMeta });
  let ledger: Ledger = initialLedger(state, 0, 0);
  const posts: Batch[] = [];
  const resolved: Record<string, BarrierResult> = {};
  const dropped: Dropped[] = [];
  const changes: ErrorChange[] = [];
  let lost = false;

  const feed = (input: LedgerInput) => {
    const out = step(deepFreeze(ledger), input);
    ledger = out.ledger;
    if (out.post !== undefined) posts.push(out.post);
    for (const { id, result } of out.resolved) resolved[id] = result;
    dropped.push(...out.dropped);
    changes.push(...out.errorChanges);
    if (out.lost === true) lost = true;
    return out;
  };

  // Dispatches as the store does, and tells the ledger as the client will.
  const dispatch = (...msgs: RackMsg[]) => {
    for (const msg of msgs) {
      const id = `env-${envelopes++}`;
      const { state: after } = reduce(state, { id, origin: "user", msg });
      if (after === state) continue;
      const rackChanged = after.rev !== state.rev;
      state = deepFreeze(after);
      if (rackChanged)
        feed({ _tag: "DesiredChanged", state, workSeq: state.workSeq });
      else if (
        msg._tag === "Run" ||
        msg._tag === "Stop" ||
        msg._tag === "PlayEvent" ||
        msg._tag === "Retry"
      )
        feed({
          _tag: "WorkAccepted",
          work: { seq: state.workSeq, envelopeId: id, trigger: msg },
        });
    }
  };

  const lastPost = () => {
    const post = posts.at(-1);
    if (post === undefined) throw new Error("nothing was posted");
    return post;
  };

  const posted = () => feed({ _tag: "Posted", batchId: lastPost().batchId });

  // Answers the last batch, failing the commands named in `failures`.
  const reply = (
    failures: Readonly<Record<string, Failure>> = {},
    batch = lastPost(),
  ) =>
    feed({
      _tag: "Replied",
      result: {
        v: 2,
        type: "batchResult",
        gen: batch.gen,
        batchId: batch.batchId,
        results: batch.commands.map(({ cmdId, command }) => {
          const name = Object.values(command).find(
            (value) => typeof value === "string" && value !== command.name,
          );
          return answer(
            cmdId,
            command,
            failures[`${command.name} ${String(name)}`] ??
              failures[command.name],
          );
        }),
      },
    });

  // Posts and answers batches until nothing is in flight, failing the
  // commands named in `failures` wherever they come up.
  const roundTrip = (failures: Readonly<Record<string, Failure>> = {}) => {
    for (let rounds = 0; ledger.inFlight !== undefined; rounds += 1) {
      if (rounds > 10) throw new Error("the ledger never settled");
      if (!ledger.inFlight.posted) posted();
      reply(failures);
    }
  };

  const barrier = (id: string, deadline = Number.POSITIVE_INFINITY) =>
    feed({
      _tag: "BarrierOpened",
      id,
      workSeq: state.workSeq,
      deadline,
    });

  return {
    feed,
    dispatch,
    posted,
    reply,
    roundTrip,
    barrier,
    posts,
    resolved,
    dropped,
    changes,
    lastPost,
    state: () => state,
    ledger: () => ledger,
    lost: () => lost,
    connect: (gen = 1) => feed({ _tag: "Connected", gen }),
    tick: (now: number) => feed({ _tag: "Tick", now }),
  };
};

const commandNames = (batch: Batch) =>
  batch.commands.map(({ command }) => {
    const { name, ...rest } = command;
    const id = Object.values(rest).find((value) => typeof value === "string");
    return id === undefined ? name : `${name} ${id}`;
  });

const built = () => {
  const w = world();
  w.connect();
  w.dispatch(synth, destination, connect);
  w.roundTrip();
  return w;
};

// --- C1: settlement ---------------------------------------------------------

test("C1 an empty rack is settled as soon as it connects", () => {
  const w = world();
  w.connect();
  w.barrier("b");

  expect(w.posts).toEqual([]);
  expect(w.resolved).toEqual({ b: { _tag: "Settled" } });
});

test("C1 a change with nothing to send settles without posting", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.posted();
  const posts = w.posts.length;

  // Made and gone again before the frame could be sent either.
  w.dispatch(
    { _tag: "AddBlock", blockId: "brief", blockType: "leaf" },
    { _tag: "RemoveBlocks", blockIds: ["brief"] },
  );
  w.barrier("b");
  w.reply();

  expect(w.posts).toHaveLength(posts);
  expect(w.ledger().inFlight).toBeUndefined();
  expect(w.ledger().settledSeq).toBe(w.state().workSeq);
  expect(w.resolved.b).toEqual({ _tag: "Settled" });
  // What changed without a command still goes with the next batch.
  w.dispatch(setVolume(-3));
  expect(Object.keys(w.lastPost().changes)).toContain("blocks");
});

test("C1 a barrier waits for the reply to the work before it", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.barrier("b");

  expect(w.resolved.b).toBeUndefined();
  w.posted();
  expect(w.resolved.b).toBeUndefined();
  w.reply();
  expect(w.resolved.b).toEqual({ _tag: "Settled" });
});

test("C1 a retry or a trigger at a settled revision is still waited for", () => {
  const w = built();
  w.barrier("before");
  expect(w.resolved.before).toEqual({ _tag: "Settled" });

  w.dispatch({ _tag: "Retry", entity: "block", entityId: "synth" });
  w.barrier("retry");
  expect(w.resolved.retry).toBeUndefined();
  expect(commandNames(w.lastPost())).toEqual(["addBlock synth", "addPatch p"]);
  w.roundTrip();
  expect(w.resolved.retry).toEqual({ _tag: "Settled" });

  w.dispatch({ _tag: "PlayEvent", eventId: riff });
  w.barrier("play");
  expect(w.resolved.play).toBeUndefined();
  w.roundTrip();
  expect(w.resolved.play).toEqual({ _tag: "Settled" });
});

test("C1 a barrier from a lost connection never settles after a reconnect", () => {
  const w = world();
  w.connect(1);
  w.dispatch(synth);
  w.barrier("old");
  w.posted();

  w.connect(2);
  expect(w.resolved.old).toEqual({ _tag: "Disconnected" });
  w.roundTrip();
  expect(w.resolved.old).toEqual({ _tag: "Disconnected" });
});

test("C1 a barrier opened while disconnected says so at once", () => {
  const w = world();
  w.dispatch(synth);
  w.barrier("b");

  expect(w.resolved.b).toEqual({ _tag: "Disconnected" });
});

test("C1 a barrier times out while the connection is alive, and is told apart from a lost one", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.barrier("b", 2000);
  w.posted();

  w.tick(1999);
  expect(w.resolved.b).toBeUndefined();
  w.tick(2000);
  expect(w.resolved.b).toEqual({ _tag: "TimedOut" });
  expect(w.ledger().connection).toEqual({ _tag: "Connected", gen: 1 });
});

test("C1 the frame is lost after five visible seconds without a reply", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.barrier("b");
  w.posted();

  w.tick(livenessMs - 1);
  expect(w.lost()).toBe(false);
  w.tick(livenessMs);
  expect(w.lost()).toBe(true);
  expect(w.resolved.b).toEqual({ _tag: "Disconnected" });
});

test("C1 hidden time does not count towards losing the frame", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.posted();

  w.feed({ _tag: "VisibilityChanged", visible: false });
  w.tick(60_000);
  expect(w.lost()).toBe(false);
  w.feed({ _tag: "VisibilityChanged", visible: true });
  w.tick(60_000 + livenessMs - 1);
  expect(w.lost()).toBe(false);
  w.tick(60_000 + livenessMs);
  expect(w.lost()).toBe(true);
});

test("C1 a batch that cannot be posted is quarantined until the rack changes", () => {
  const w = built();
  const sent = w.ledger().sent;
  w.dispatch(setVolume(-6));
  const failed = w.lastPost();

  w.feed({
    _tag: "PostFailed",
    batchId: failed.batchId,
    cause: "DataCloneError",
  });
  w.barrier("b");
  w.tick(10_000);

  expect(w.ledger().sent).toBe(sent);
  expect(w.posts.at(-1)).toBe(failed);
  expect(w.resolved.b).toEqual({ _tag: "Blocked", cause: "DataCloneError" });

  w.dispatch(setVolume(-3));
  expect(w.posts.at(-1)).not.toBe(failed);
  expect(commandNames(w.lastPost())).toEqual([`updateParam ${volume}`]);
  // Diffed from the rack last posted, so nothing the failed batch held is lost.
  expect(Object.keys(w.lastPost().changes)).toContain("values");
});

test("C1 a retry also lifts a quarantine", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.feed({ _tag: "PostFailed", batchId: w.lastPost().batchId, cause: "x" });
  const posts = w.posts.length;

  w.dispatch({ _tag: "Retry", entity: "block", entityId: "out" });

  expect(w.posts).toHaveLength(posts + 1);
});

// --- C1 and C3: ordering ------------------------------------------------------

test("C1 edits made while a batch is in flight fold into the next batch", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.posted();
  const posts = w.posts.length;

  w.dispatch(setVolume(-5), setVolume(-4), { _tag: "SetTransport", bpm: 90 });
  expect(w.posts).toHaveLength(posts);
  w.reply();

  expect(commandNames(w.lastPost())).toEqual([
    `updateParam ${volume}`,
    "updateTransport",
  ]);
  expect(w.lastPost().changes.values?.[volume]).toBe(-4);
});

test("C3 a trigger goes after the edits made before it, in the same batch", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.posted();
  w.dispatch(setVolume(-3), { _tag: "PlayEvent", eventId: riff });
  w.reply();

  expect(commandNames(w.lastPost())).toEqual([
    `updateParam ${volume}`,
    "runLeafMethod synth:method:triggerAttackRelease",
  ]);
});

test("C3 triggers are dropped while disconnected, except Stop", () => {
  const w = world();
  w.dispatch(
    synth,
    { _tag: "Run" },
    { _tag: "PlayEvent", eventId: riff },
    { _tag: "Stop" },
  );

  expect(
    w.dropped.map(({ work, reason }) => [work.trigger._tag, reason]),
  ).toEqual([
    ["Run", "NotConnected"],
    ["PlayEvent", "NotConnected"],
  ]);
});

test("C3 triggers waiting to be posted are dropped when the frame changes", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.posted();
  w.dispatch({ _tag: "Run" });

  w.connect(2);

  expect(w.dropped.map(({ work }) => work.trigger._tag)).toEqual(["Run"]);
  expect(commandNames(w.lastPost())).not.toContain("render");
});

test("C3 a play for an event that has since gone is dropped", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.posted();
  w.dispatch(
    { _tag: "PlayEvent", eventId: riff },
    { _tag: "RemoveEvent", eventId: riff },
  );
  w.reply();

  expect(w.dropped.map(({ reason }) => reason)).toEqual(["Gone"]);
});

// --- C2: recovery -------------------------------------------------------------

test("C2 a param change on a block that failed to build rebuilds it", () => {
  const w = world();
  w.connect();
  w.dispatch(synth, destination, connect);
  w.roundTrip({
    "addBlock synth": fail("LeafThrew"),
    "addPatch p": fail("EndpointFailed"),
  });

  w.dispatch(setVolume(-6));

  expect(commandNames(w.lastPost())).toEqual(["addBlock synth", "addPatch p"]);
  w.roundTrip();
  expect(w.ledger().errors).toEqual({});
});

test("C2 an unchanged failure is not retried by unrelated edits", () => {
  const w = world();
  w.connect();
  w.dispatch(synth, destination);
  w.roundTrip({ "addBlock synth": fail("LeafThrew") });

  w.dispatch({ _tag: "SetTransport", bpm: 90 });

  expect(commandNames(w.lastPost())).toEqual(["updateTransport"]);
});

test("C2 Retry rebuilds an unchanged failed block", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.roundTrip({ "addBlock synth": fail("LeafThrew") });

  w.dispatch({ _tag: "Retry", entity: "block", entityId: "synth" });

  expect(commandNames(w.lastPost())).toEqual(["addBlock synth"]);
  expect(
    w.ledger().inFlight?.commands.get(w.lastPost().commands[0]?.cmdId ?? 0)
      ?.cause,
  ).toMatchObject({ entity: "block", id: "synth" });
});

test("C2 a reconnect resyncs the new frame from nothing", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.posted();

  w.connect(2);

  const resync = w.lastPost();
  expect(resync.gen).toBe(2);
  expect(commandNames(resync)).toEqual([
    "addBlock synth",
    "addBlock out",
    "addPatch p",
  ]);
  expect(Object.keys(resync.changes).sort()).toEqual(
    Object.keys(initialRackState).sort(),
  );
});

test("C2 a reconnect clears every error and lets the resync find them again", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.roundTrip({ "addBlock synth": fail("LeafThrew") });
  expect(Object.keys(w.ledger().errors)).toEqual(["build:synth"]);

  w.connect(2);
  expect(w.ledger().errors).toEqual({});
  w.roundTrip({ "addBlock synth": fail("LeafThrew") });
  expect(Object.keys(w.ledger().errors)).toEqual(["build:synth"]);
});

// --- C4 and C5: errors, causes, watermarks --------------------------------------

test("C5 an error records its code, command and cause", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.roundTrip({ "addBlock synth": fail("LeafThrew", "boom") });

  expect(w.ledger().errors["build:synth"]).toEqual({
    kind: "build",
    id: "synth",
    incarnation: w.state().incarnations.block.synth,
    code: "LeafThrew",
    message: "boom",
    gen: 1,
    cmdId: 1,
    cause: expect.objectContaining({ entity: "block", id: "synth" }),
  });
  expect(w.changes).toEqual([
    { _tag: "Set", entry: w.ledger().errors["build:synth"] },
  ]);
});

test("C5 a patch whose end did not build names that block as the root cause", () => {
  const w = world();
  w.connect();
  w.dispatch(synth, destination, connect);
  w.roundTrip({
    "addBlock synth": fail("LeafThrew"),
    "addPatch p": fail("EndpointFailed"),
  });

  expect(w.ledger().errors["connect:p"]?.rootCause).toBe("synth");
});

test("C5 a later success clears an earlier failure", () => {
  const w = built();
  w.dispatch(setVolume(-6));
  w.roundTrip({ updateParam: fail("ParamRejected") });
  expect(Object.keys(w.ledger().errors)).toEqual([`param:${volume}`]);

  w.dispatch(setVolume(-3));
  w.roundTrip();

  expect(w.ledger().errors).toEqual({});
  expect(w.changes.at(-1)).toEqual({ _tag: "Cleared", key: `param:${volume}` });
});

test("C5 a later play that works clears an earlier one that failed, at the same revision", () => {
  const w = built();
  const rev = w.state().rev;
  w.dispatch({ _tag: "PlayEvent", eventId: riff });
  w.roundTrip({ runLeafMethod: fail("MethodThrew") });
  expect(Object.keys(w.ledger().errors)).toEqual([`play:${riff}`]);

  w.dispatch({ _tag: "PlayEvent", eventId: riff });
  w.roundTrip();

  expect(w.state().rev).toBe(rev);
  expect(w.ledger().errors).toEqual({});
});

test("C5 a reply from an old connection or an old batch is ignored", () => {
  const w = world();
  w.connect(1);
  w.dispatch(synth);
  w.posted();
  const old = w.lastPost();
  w.connect(2);
  w.posted();

  w.reply({ addBlock: fail("LeafThrew") }, old);
  expect(w.ledger().errors).toEqual({});
  expect(w.ledger().inFlight?.batchId).toBe(w.lastPost().batchId);
});

test("C5 a result for an entity deleted meanwhile is dropped", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.posted();
  w.dispatch({ _tag: "RemoveBlocks", blockIds: ["synth"] });

  w.reply({ addBlock: fail("LeafThrew") });

  expect(w.ledger().errors).toEqual({});
});

test("C5 deleting an entity forgets its errors", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.roundTrip({ addBlock: fail("LeafThrew") });

  w.dispatch({ _tag: "RemoveBlocks", blockIds: ["synth"] });

  expect(w.ledger().errors).toEqual({});
  expect(w.ledger().watermarks).toEqual({});
  expect(w.changes.at(-1)).toEqual({ _tag: "Cleared", key: "build:synth" });
});

test("C5 an id deleted and made again while its build is in flight is a new entity", () => {
  const w = world();
  w.connect();
  w.dispatch(synth);
  w.posted();
  w.dispatch({ _tag: "RemoveBlocks", blockIds: ["synth"] }, synth);

  w.reply({ addBlock: fail("LeafThrew") });

  // The old build's failure is not the new block's.
  expect(w.ledger().errors).toEqual({});
  expect(commandNames(w.lastPost())).toEqual([
    `deleteEvent ${riff}`,
    "deleteBlock synth",
    "addBlock synth",
  ]);
});

// --- C6: playback -------------------------------------------------------------

const playback = (
  w: ReturnType<typeof world>,
  scheduleCmdId: number,
  gen = 1,
) =>
  w.feed({
    _tag: "PlaybackReported",
    report: {
      v: 2,
      type: "playback",
      gen,
      eventId: riff,
      scheduleCmdId,
      message: "bad note",
    } satisfies Playback,
  });

test("C6 a playback failure lands on the event's current schedule", () => {
  const w = built();
  w.dispatch({
    _tag: "AddEvent",
    eventId: "e",
    methodId: "synth:method:triggerAttackRelease",
    settings: {
      kind: "sequence",
      args: { duration: "8n" },
      mute: false,
      steps: ["C4"],
      subdivision: "4n",
    },
  });
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: true } });
  w.roundTrip();
  const cmdId =
    w
      .lastPost()
      .commands.find(
        ({ command }) =>
          command.name === "updateEvent" && command.eventId === riff,
      )?.cmdId ?? 0;

  playback(w, cmdId);

  expect(w.ledger().errors[`playback:${riff}`]).toMatchObject({
    code: "PlaybackThrew",
    message: "bad note",
    cmdId,
  });
});

test("C6 a report from an older schedule is ignored", () => {
  const w = built();
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: true } });
  w.roundTrip();
  const first = w.lastPost().commands[0]?.cmdId ?? 0;
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: false } });
  w.roundTrip();

  playback(w, first);

  expect(w.ledger().errors).toEqual({});
});

test("C6 a report that arrives before its batch's reply lands after it", () => {
  const w = built();
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: true } });
  w.posted();
  const cmdId = w.lastPost().commands[0]?.cmdId ?? 0;

  playback(w, cmdId);
  expect(w.ledger().errors).toEqual({});
  w.reply();

  expect(Object.keys(w.ledger().errors)).toEqual([`playback:${riff}`]);
});

test("C6 a failed reschedule leaves the event with no schedule", () => {
  const w = built();
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: true } });
  w.roundTrip();
  const working = w.lastPost().commands[0]?.cmdId ?? 0;
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: false } });
  w.roundTrip({ updateEvent: fail("ScheduleFailed") });

  playback(w, working);

  expect(w.ledger().schedules[riff]).toBeNull();
  expect(Object.keys(w.ledger().errors)).toEqual([`schedule:${riff}`]);
});

test("C6 a new schedule clears the old one's playback failure", () => {
  const w = built();
  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: true } });
  w.roundTrip();
  playback(w, w.lastPost().commands[0]?.cmdId ?? 0);
  expect(Object.keys(w.ledger().errors)).toEqual([`playback:${riff}`]);

  w.dispatch({ _tag: "UpdateEvent", eventId: riff, settings: { mute: false } });
  w.roundTrip();

  expect(w.ledger().errors).toEqual({});
});

test("C6 Stop takes schedules away without counting as failures", () => {
  const w = built();
  w.dispatch({ _tag: "Stop" });
  w.posted();
  const stop = w.lastPost();
  w.feed({
    _tag: "Replied",
    result: {
      v: 2,
      type: "batchResult",
      gen: 1,
      batchId: stop.batchId,
      results: [
        {
          cmdId: stop.commands[0]?.cmdId ?? 0,
          entities: [{ entity: "event", id: riff, removed: true }],
        },
      ],
    },
  });

  expect(w.ledger().schedules[riff]).toBeNull();
  expect(w.ledger().errors).toEqual({});
});

test("C5 an older result never overrides a newer one for the same entity", () => {
  const w = built();
  w.dispatch(
    { _tag: "Retry", entity: "block", entityId: "synth" },
    { _tag: "Run" },
  );
  w.roundTrip();
  w.dispatch({ _tag: "Retry", entity: "block", entityId: "synth" });
  w.posted();
  const batch = w.lastPost();
  const rebuild = batch.commands[0]?.cmdId ?? 0;

  // A newer render says the synth built; the older rebuild's failure comes
  // after it in the reply.
  w.feed({
    _tag: "Replied",
    result: {
      v: 2,
      type: "batchResult",
      gen: 1,
      batchId: batch.batchId,
      results: [
        { cmdId: rebuild + 5, entities: [{ entity: "block", id: "synth" }] },
        {
          cmdId: rebuild,
          failure: fail("LeafThrew"),
          entities: [
            { entity: "block", id: "synth", failure: fail("LeafThrew") },
          ],
        },
      ],
    },
  });

  expect(w.ledger().errors).toEqual({});
});
