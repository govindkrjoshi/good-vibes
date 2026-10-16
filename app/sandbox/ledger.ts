import type { EntityKind } from "../rack/entities";
import type { RenderErrorCode } from "../rack/model";
import { playArgs, type RackWork } from "../rack/reduce";
import {
  rackChanges,
  type Batch,
  type BatchResult,
  type Command,
  type Failure,
  type Playback,
} from "./protocol";
import {
  commandsFor,
  emptySnapshot,
  type Cause,
  type ErrorKind,
  type Forced,
  type Planned,
  type Snapshot,
} from "./reconcile";

// The app's record of what the sandbox frame has been sent and what came of
// it, as a pure state machine: `step` takes the ledger and one thing that
// happened, and gives the next ledger and what to do about it. The client
// that drives it owns the port, the clock and the store subscription; this
// owns every decision. See the migration plan's contracts C1 to C6.
//
// In short:
// - At most one batch is in flight. When its reply comes back, the next batch
//   is the diff from the rack last sent to the rack now, so edits made in
//   the meantime fold into one.
// - Every unit of work the store accepts has a `workSeq`. A barrier waits
//   until all work up to the seq it captured has been answered, in the same
//   connection (`gen`), or says why it cannot.
// - Errors are kept per kind and entity, and a result only lands if it is
//   newer than the last one that did (its watermark) and for the entity as
//   it now is (its incarnation).

// Work for the frame that is not a change to the rack.
export type Work = RackWork;

export type ErrorCode = RenderErrorCode | "PlaybackThrew";

export type ErrorEntry = {
  readonly kind: ErrorKind;
  readonly id: string;
  readonly incarnation?: string;
  readonly code: ErrorCode;
  readonly message: string;
  readonly gen: number;
  readonly cmdId: number;
  readonly cause?: Cause;
  // For a patch whose end did not build: the block that did not.
  readonly rootCause?: string;
};

export type ErrorChange =
  | { readonly _tag: "Set"; readonly entry: ErrorEntry }
  | { readonly _tag: "Cleared"; readonly key: string };

export type BarrierResult =
  | { readonly _tag: "Settled" }
  | { readonly _tag: "Disconnected" }
  | { readonly _tag: "Blocked"; readonly cause: string }
  | { readonly _tag: "TimedOut" };

export type Connection =
  | { readonly _tag: "Disconnected" }
  | { readonly _tag: "Connected"; readonly gen: number }
  | { readonly _tag: "Lost"; readonly gen: number };

type Barrier = {
  readonly gen: number;
  readonly seq: number;
  readonly deadline: number;
};

type Sent = Planned & { readonly work?: Work };

type InFlight = {
  readonly batchId: number;
  // Every unit of work up to this seq is in this batch or already answered.
  readonly seq: number;
  readonly snapshot: Snapshot;
  readonly commands: ReadonlyMap<number, Sent>;
  readonly posted: boolean;
  // Visible time since it was posted; see `livenessMs`.
  readonly waited: number;
};

type Watermark = {
  readonly gen: number;
  readonly cmdId: number;
  readonly incarnation?: string;
};

export type Ledger = {
  readonly connection: Connection;
  readonly gen: number;
  // The rack as the store has it now, and the seq of its latest change.
  readonly desired: Snapshot;
  // The highest seq of any work accepted so far.
  readonly latestSeq: number;
  // The rack last posted to the current frame.
  readonly sent: Snapshot;
  readonly settledSeq: number;
  // Triggers and retries accepted and not yet posted.
  readonly work: readonly Work[];
  readonly inFlight?: InFlight;
  readonly nextBatchId: number;
  readonly nextCmdId: number;
  readonly errors: Readonly<Record<string, ErrorEntry>>;
  readonly watermarks: Readonly<Record<string, Watermark>>;
  // The command that built each event's current schedule, or null when it
  // has none.
  readonly schedules: Readonly<
    Record<string, { readonly gen: number; readonly cmdId: number } | null>
  >;
  // Playback reports from schedules in the batch in flight, until its reply.
  readonly held: readonly Playback[];
  // A batch that could not be posted, and the seq it covered.
  readonly blocked?: { readonly cause: string; readonly seq: number };
  readonly barriers: Readonly<Record<string, Barrier>>;
  readonly visible: boolean;
  readonly now: number;
};

export type LedgerInput =
  | {
      readonly _tag: "DesiredChanged";
      readonly state: Snapshot;
      readonly workSeq: number;
    }
  | { readonly _tag: "WorkAccepted"; readonly work: Work }
  | {
      readonly _tag: "BarrierOpened";
      readonly id: string;
      readonly workSeq: number;
      readonly deadline: number;
    }
  | { readonly _tag: "BarrierCancelled"; readonly id: string }
  | { readonly _tag: "Connected"; readonly gen: number }
  | { readonly _tag: "Posted"; readonly batchId: number }
  | {
      readonly _tag: "PostFailed";
      readonly batchId: number;
      readonly cause: string;
    }
  | { readonly _tag: "Replied"; readonly result: BatchResult }
  | { readonly _tag: "PlaybackReported"; readonly report: Playback }
  | { readonly _tag: "Lost" }
  | { readonly _tag: "VisibilityChanged"; readonly visible: boolean }
  | { readonly _tag: "Tick"; readonly now: number };

export type Dropped = {
  readonly work: Work;
  readonly reason: "NotConnected" | "Blocked" | "Gone";
};

export type LedgerOutput = {
  readonly ledger: Ledger;
  // Post this now, then report Posted or PostFailed.
  readonly post?: Batch;
  readonly resolved: readonly {
    readonly id: string;
    readonly result: BarrierResult;
  }[];
  readonly dropped: readonly Dropped[];
  readonly errorChanges: readonly ErrorChange[];
  // The frame stopped answering; drop the port and connect again.
  readonly lost?: true;
};

// How long a batch may go unanswered, in visible time, before the frame is
// taken to be gone. Hidden pages are throttled, so hidden time does not count.
export const livenessMs = 5000;

export const initialLedger = (
  desired: Snapshot,
  workSeq: number,
  now = 0,
): Ledger => ({
  connection: { _tag: "Disconnected" },
  gen: 0,
  desired,
  latestSeq: workSeq,
  sent: emptySnapshot,
  settledSeq: 0,
  work: [],
  nextBatchId: 1,
  nextCmdId: 1,
  errors: {},
  watermarks: {},
  schedules: {},
  held: [],
  barriers: {},
  visible: true,
  now,
});

export const errorKey = (kind: ErrorKind, id: string) => `${kind}:${id}`;

const entityOfKind = (kind: ErrorKind): EntityKind =>
  kind === "build"
    ? "block"
    : kind === "connect"
      ? "patch"
      : kind === "param"
        ? "param"
        : "event";

const kindOfEntity = (entity: "block" | "patch" | "event"): ErrorKind =>
  entity === "block" ? "build" : entity === "patch" ? "connect" : "schedule";

const isConnected = (ledger: Ledger) =>
  ledger.connection._tag === "Connected" &&
  ledger.connection.gen === ledger.gen;

const without = <T>(record: Readonly<Record<string, T>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([held]) => held !== key));

// --- Results --------------------------------------------------------------

type Landing = {
  readonly kind: ErrorKind;
  readonly id: string;
  readonly incarnation: string | undefined;
  readonly cmdId: number;
  readonly failure: Failure | undefined;
  readonly cause: Cause | undefined;
};

// Lands one result on the ledger if it is for the entity as it now is and
// newer than the last result that landed for the same kind and entity.
const land = (ledger: Ledger, result: Landing): Ledger => {
  const entity = entityOfKind(result.kind);
  if (ledger.desired.incarnations[entity][result.id] !== result.incarnation)
    return ledger;
  const key = errorKey(result.kind, result.id);
  const mark = ledger.watermarks[key];
  if (
    mark !== undefined &&
    mark.gen === ledger.gen &&
    mark.incarnation === result.incarnation &&
    result.cmdId <= mark.cmdId
  )
    return ledger;

  const watermarks = {
    ...ledger.watermarks,
    [key]: {
      gen: ledger.gen,
      cmdId: result.cmdId,
      ...(result.incarnation === undefined
        ? {}
        : { incarnation: result.incarnation }),
    },
  };
  if (result.failure === undefined)
    return { ...ledger, watermarks, errors: without(ledger.errors, key) };

  const rootCause =
    result.failure.code === "EndpointFailed"
      ? endpointThatFailed(ledger, result.id)
      : undefined;
  const entry: ErrorEntry = {
    kind: result.kind,
    id: result.id,
    ...(result.incarnation === undefined
      ? {}
      : { incarnation: result.incarnation }),
    code: result.failure.code,
    message: result.failure.message,
    gen: ledger.gen,
    cmdId: result.cmdId,
    ...(result.cause === undefined ? {} : { cause: result.cause }),
    ...(rootCause === undefined ? {} : { rootCause }),
  };
  return { ...ledger, watermarks, errors: { ...ledger.errors, [key]: entry } };
};

const endpointThatFailed = (ledger: Ledger, patchId: string) => {
  const patch = ledger.desired.patches[patchId];
  if (patch === undefined) return undefined;
  return [patch.from, patch.to]
    .map((jack) => ledger.desired.jacks[jack]?.belongToBlockId)
    .find(
      (block) =>
        block !== undefined &&
        ledger.errors[errorKey("build", block)] !== undefined,
    );
};

const landPlayback = (ledger: Ledger, report: Playback): Ledger => {
  const schedule = ledger.schedules[report.eventId];
  if (
    schedule === undefined ||
    schedule === null ||
    schedule.gen !== report.gen ||
    schedule.cmdId !== report.scheduleCmdId
  )
    return ledger;
  // An event the rack no longer has cannot fail any more.
  const incarnation = ledger.desired.incarnations.event[report.eventId];
  if (incarnation === undefined) return ledger;
  const key = errorKey("playback", report.eventId);
  return {
    ...ledger,
    errors: {
      ...ledger.errors,
      [key]: {
        kind: "playback",
        id: report.eventId,
        incarnation,
        code: "PlaybackThrew",
        message: report.message,
        gen: report.gen,
        cmdId: report.scheduleCmdId,
      },
    },
  };
};

const applyReply = (
  ledger: Ledger,
  inFlight: InFlight,
  result: BatchResult,
): Ledger =>
  result.results.reduce((acc, { cmdId, failure, entities }) => {
    const sent = inFlight.commands.get(cmdId);
    const incarnations = inFlight.snapshot.incarnations;
    let next = acc;
    const covered = new Set<string>();

    for (const one of entities) {
      const kind = kindOfEntity(one.entity);
      covered.add(errorKey(kind, one.id));
      if (one.entity === "event") {
        // A new schedule, or none: either way the old one's failures are
        // done with.
        next = {
          ...next,
          errors: without(next.errors, errorKey("playback", one.id)),
          schedules: {
            ...next.schedules,
            [one.id]:
              one.removed === true || one.failure !== undefined
                ? null
                : { gen: next.gen, cmdId },
          },
        };
      }
      // Taken away in the frame, like every event on Stop, is not a result
      // about whether it works.
      if (one.removed === true) continue;
      next = land(next, {
        kind,
        id: one.id,
        incarnation: incarnations[one.entity][one.id],
        cmdId,
        failure: one.failure,
        cause: sent?.cause,
      });
    }

    const kind = sent?.errorKind;
    if (sent === undefined || kind === undefined) return next;
    if (covered.has(errorKey(kind, sent.target.id))) return next;
    return land(next, {
      kind,
      id: sent.target.id,
      incarnation: sent.target.incarnation,
      cmdId,
      failure,
      cause: sent.cause,
    });
  }, ledger);

// --- Planning -------------------------------------------------------------

const failedIn = (ledger: Ledger) => (kind: ErrorKind, id: string) =>
  ledger.errors[errorKey(kind, id)] !== undefined;

const retryCause = (
  ledger: Ledger,
  work: Work,
  entity: EntityKind,
  id: string,
) => ({
  rev: ledger.desired.stamps[entity][id]?.rev ?? 0,
  envelopeId: work.envelopeId,
  entity,
  id,
});

const triggerCommand = (
  ledger: Ledger,
  work: Work,
): Sent | "Gone" | undefined => {
  const { trigger } = work;
  switch (trigger._tag) {
    case "Run":
      return {
        command: { name: "render" },
        target: { entity: "transport", id: "transport" },
        work,
      };
    case "Stop":
      return {
        command: { name: "stop" },
        target: { entity: "transport", id: "transport" },
        work,
      };
    case "PlayEvent": {
      const play = playArgs(ledger.desired, trigger.eventId);
      if (play === undefined) return "Gone";
      const incarnation = ledger.desired.incarnations.event[trigger.eventId];
      return {
        command: {
          name: "runLeafMethod",
          methodId: play.methodId,
          args: play.args,
        },
        target: {
          entity: "event",
          id: trigger.eventId,
          ...(incarnation === undefined ? {} : { incarnation }),
        },
        errorKind: "play",
        cause: retryCause(ledger, work, "event", trigger.eventId),
        work,
      };
    }
    case "Retry":
      return undefined;
  }
};

type Plan = {
  readonly ledger: Ledger;
  readonly post?: Batch;
  readonly dropped: readonly Dropped[];
};

const plan = (ledger: Ledger): Plan => {
  if (!isConnected(ledger) || ledger.inFlight !== undefined) {
    return { ledger, dropped: [] };
  }
  if (ledger.blocked !== undefined) return { ledger, dropped: [] };

  const forced: Forced[] = ledger.work.flatMap(({ trigger, ...work }) =>
    trigger._tag === "Retry"
      ? [
          {
            entity: trigger.entity,
            id: trigger.entityId,
            cause: retryCause(
              ledger,
              { ...work, trigger },
              trigger.entity,
              trigger.entityId,
            ),
          },
        ]
      : [],
  );
  const triggers = ledger.work.map((work) => ({
    work,
    sent: triggerCommand(ledger, work),
  }));
  const dropped = triggers.flatMap(({ work, sent }): Dropped[] =>
    sent === "Gone" ? [{ work, reason: "Gone" }] : [],
  );
  const planned: Sent[] = [
    ...commandsFor(ledger.sent, ledger.desired, failedIn(ledger), forced),
    ...triggers.flatMap(({ sent }) =>
      sent === undefined || sent === "Gone" ? [] : [sent],
    ),
  ];

  if (planned.length === 0) {
    // Nothing to send: the frame is as current as it can be. `sent` stays,
    // so whatever changed without needing a command still goes with the
    // next batch.
    return {
      ledger: { ...ledger, work: [], settledSeq: ledger.latestSeq },
      dropped,
    };
  }

  const commands = planned.map((one, index) => ({
    cmdId: ledger.nextCmdId + index,
    one,
  }));
  const post: Batch = {
    v: 2,
    type: "batch",
    gen: ledger.gen,
    batchId: ledger.nextBatchId,
    // A frame that has been sent nothing yet gets the whole rack.
    changes: rackChanges(
      ledger.sent === emptySnapshot ? undefined : ledger.sent,
      ledger.desired,
    ),
    commands: commands.map(({ cmdId, one }) => ({
      cmdId,
      command: one.command satisfies Command,
    })),
  };
  return {
    ledger: {
      ...ledger,
      work: [],
      nextBatchId: ledger.nextBatchId + 1,
      nextCmdId: ledger.nextCmdId + planned.length,
      inFlight: {
        batchId: post.batchId,
        seq: ledger.latestSeq,
        snapshot: ledger.desired,
        commands: new Map(commands.map(({ cmdId, one }) => [cmdId, one])),
        posted: false,
        waited: 0,
      },
    },
    post,
    dropped,
  };
};

// --- Barriers -------------------------------------------------------------

const resolveBarriers = (ledger: Ledger) => {
  const resolved: { id: string; result: BarrierResult }[] = [];
  const barriers: Record<string, Barrier> = {};
  for (const [id, barrier] of Object.entries(ledger.barriers)) {
    const result: BarrierResult | undefined =
      barrier.gen !== ledger.gen || !isConnected(ledger)
        ? { _tag: "Disconnected" }
        : ledger.settledSeq >= barrier.seq
          ? { _tag: "Settled" }
          : ledger.blocked !== undefined
            ? { _tag: "Blocked", cause: ledger.blocked.cause }
            : ledger.now >= barrier.deadline
              ? { _tag: "TimedOut" }
              : undefined;
    if (result === undefined) barriers[id] = barrier;
    else resolved.push({ id, result });
  }
  return { ledger: { ...ledger, barriers }, resolved };
};

const errorChanges = (before: Ledger, after: Ledger): ErrorChange[] => [
  ...Object.entries(after.errors)
    .filter(([key, entry]) => before.errors[key] !== entry)
    .map(([, entry]): ErrorChange => ({ _tag: "Set", entry })),
  ...Object.keys(before.errors)
    .filter((key) => after.errors[key] === undefined)
    .map((key): ErrorChange => ({ _tag: "Cleared", key })),
];

// Forgets errors and watermarks of entities the rack no longer has as they
// were: deleted, or replaced under the same id.
const prune = (ledger: Ledger): Ledger => {
  const current = (kind: ErrorKind, id: string, incarnation?: string) =>
    ledger.desired.incarnations[entityOfKind(kind)][id] === incarnation &&
    (incarnation !== undefined ||
      id in ledger.desired.blocks ||
      id in ledger.desired.patches ||
      id in ledger.desired.events ||
      id in ledger.desired.params);
  return {
    ...ledger,
    errors: Object.fromEntries(
      Object.entries(ledger.errors).filter(([, entry]) =>
        current(entry.kind, entry.id, entry.incarnation),
      ),
    ),
    watermarks: Object.fromEntries(
      Object.entries(ledger.watermarks).filter(([key, mark]) => {
        const [kind, ...id] = key.split(":");
        return current(kind as ErrorKind, id.join(":"), mark.incarnation);
      }),
    ),
  };
};

// --- Step -----------------------------------------------------------------

export const step = (ledger: Ledger, input: LedgerInput): LedgerOutput => {
  let next = ledger;
  let dropped: Dropped[] = [];
  let lost: true | undefined;

  switch (input._tag) {
    case "DesiredChanged": {
      next = prune({
        ...next,
        desired: input.state,
        latestSeq: Math.max(next.latestSeq, input.workSeq),
      });
      // A newer rack is a reason to try a batch that would not post again.
      if (next.blocked !== undefined && input.workSeq > next.blocked.seq) {
        const { blocked: _, ...rest } = next;
        next = rest;
      }
      break;
    }

    case "WorkAccepted": {
      next = { ...next, latestSeq: Math.max(next.latestSeq, input.work.seq) };
      if (!isConnected(next)) {
        // Stop has nothing to stop; anything else would play out of date
        // once the frame is back.
        if (input.work.trigger._tag !== "Stop")
          dropped = [{ work: input.work, reason: "NotConnected" }];
        break;
      }
      if (input.work.trigger._tag === "Retry" && next.blocked !== undefined) {
        const { blocked: _, ...rest } = next;
        next = rest;
      }
      next = { ...next, work: [...next.work, input.work] };
      break;
    }

    case "BarrierOpened":
      next = {
        ...next,
        barriers: {
          ...next.barriers,
          [input.id]: {
            gen: next.gen,
            seq: input.workSeq,
            deadline: input.deadline,
          },
        },
      };
      break;

    case "BarrierCancelled":
      next = { ...next, barriers: without(next.barriers, input.id) };
      break;

    case "Connected": {
      dropped = next.work
        .filter((work) => work.trigger._tag !== "Stop")
        .map((work) => ({ work, reason: "NotConnected" as const }));
      const { inFlight: _, blocked: __, ...rest } = next;
      next = {
        ...rest,
        connection: { _tag: "Connected", gen: input.gen },
        gen: input.gen,
        sent: emptySnapshot,
        settledSeq: 0,
        work: [],
        errors: {},
        watermarks: {},
        schedules: {},
        held: [],
      };
      break;
    }

    case "Lost": {
      dropped = next.work
        .filter((work) => work.trigger._tag !== "Stop")
        .map((work) => ({ work, reason: "NotConnected" as const }));
      const { inFlight: _, ...rest } = next;
      next = {
        ...rest,
        connection: { _tag: "Lost", gen: next.gen },
        work: [],
        held: [],
      };
      break;
    }

    case "Posted": {
      const inFlight = next.inFlight;
      if (inFlight?.batchId !== input.batchId || inFlight.posted) break;
      next = {
        ...next,
        sent: inFlight.snapshot,
        inFlight: { ...inFlight, posted: true, waited: 0 },
      };
      break;
    }

    case "PostFailed": {
      const inFlight = next.inFlight;
      if (inFlight?.batchId !== input.batchId) break;
      dropped = [...inFlight.commands.values()].flatMap(({ work }) =>
        work === undefined ? [] : [{ work, reason: "Blocked" as const }],
      );
      const { inFlight: _, ...rest } = next;
      next = { ...rest, blocked: { cause: input.cause, seq: inFlight.seq } };
      break;
    }

    case "Replied": {
      const inFlight = next.inFlight;
      if (
        inFlight === undefined ||
        input.result.gen !== next.gen ||
        input.result.batchId !== inFlight.batchId
      )
        break;
      const { inFlight: _, ...rest } = next;
      next = applyReply(
        { ...rest, settledSeq: Math.max(next.settledSeq, inFlight.seq) },
        inFlight,
        input.result,
      );
      // Reports that came in ahead of this reply can land now.
      const held = next.held;
      next = held.reduce(landPlayback, { ...next, held: [] });
      break;
    }

    case "PlaybackReported": {
      const { report } = input;
      if (report.gen !== next.gen) break;
      if (next.inFlight?.commands.has(report.scheduleCmdId) === true) {
        next = { ...next, held: [...next.held, report] };
        break;
      }
      next = landPlayback(next, report);
      break;
    }

    case "VisibilityChanged":
      next = { ...next, visible: input.visible };
      break;

    case "Tick": {
      const elapsed = Math.max(0, input.now - next.now);
      next = { ...next, now: input.now };
      const inFlight = next.inFlight;
      if (inFlight?.posted !== true || !next.visible) break;
      const waited = inFlight.waited + elapsed;
      if (waited < livenessMs) {
        next = { ...next, inFlight: { ...inFlight, waited } };
        break;
      }
      lost = true;
      const { inFlight: _, ...rest } = next;
      next = { ...rest, connection: { _tag: "Lost", gen: next.gen } };
      break;
    }
  }

  const planned = plan(next);
  const barriers = resolveBarriers(planned.ledger);
  return {
    ledger: barriers.ledger,
    ...(planned.post === undefined ? {} : { post: planned.post }),
    resolved: barriers.resolved,
    dropped: [...dropped, ...planned.dropped],
    errorChanges: errorChanges(ledger, barriers.ledger),
    ...(lost === undefined ? {} : { lost }),
  };
};
