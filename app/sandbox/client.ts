import { Deferred, Effect, Schedule, type Scope } from "effect";
import type { StoreApi } from "zustand";
import type { RackCore, RackWork } from "../rack/reduce";
import {
  initialLedger,
  step,
  type BarrierResult,
  type Ledger,
  type LedgerInput,
  type LedgerOutput,
} from "./ledger";
import { isReply, type Batch } from "./protocol";
import {
  initialSandboxStatus,
  sandboxStatus,
  type SandboxStatus,
} from "./status";

// The app's end of the sandbox: it follows the rack store and drives the
// ledger (ledger.ts), which decides what the frame is sent and keeps what
// came of it. This only wires the ledger to the world: the store, the port,
// the clock, and whoever waits on a barrier. It holds no rules of its own.

// The end of a MessageChannel the app keeps.
export type HostPort = {
  postMessage(message: Batch): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  close(): void;
};

// The rack as the client needs it: its state, its changes, and the triggers
// it accepts.
export type RackSource = {
  readonly getState: () => RackCore;
  readonly subscribe: (
    listener: (state: RackCore, previous: RackCore) => void,
  ) => () => void;
  readonly onWork: (
    listener: (work: readonly RackWork[]) => void,
  ) => () => void;
};

export type SandboxClient = {
  // Talks to a frame over this port from now on. Each port is a new
  // connection, and the frame is sent the whole rack.
  readonly connect: (port: HostPort) => void;
  // Waits until the frame has answered all work the store had accepted when
  // this was called, or says why it cannot.
  readonly barrier: (timeoutMs: number) => Effect.Effect<BarrierResult>;
  // Hidden pages are throttled, so hidden time does not count against the
  // frame.
  readonly setVisible: (visible: boolean) => void;
};

export type SandboxClientOptions = {
  readonly now?: () => number;
  // How often the clock ticks, for barrier deadlines and liveness.
  readonly tickMs?: number;
  readonly status?: StoreApi<SandboxStatus>;
  // The frame stopped answering and its port was dropped; connect again.
  readonly onLost?: () => void;
};

const statusOf = (ledger: Ledger, held: SandboxStatus): SandboxStatus => ({
  connection: ledger.connection,
  ...(held.audio === undefined ? {} : { audio: held.audio }),
  errors: ledger.errors,
  settledSeq: ledger.settledSeq,
  latestSeq: ledger.latestSeq,
  ...(ledger.blocked === undefined
    ? {}
    : { syncBlocked: ledger.blocked.cause }),
  pending: ledger.inFlight?.commands.size ?? 0,
});

const sameStatus = (a: SandboxStatus, b: SandboxStatus) =>
  a.connection === b.connection &&
  a.audio === b.audio &&
  a.errors === b.errors &&
  a.settledSeq === b.settledSeq &&
  a.latestSeq === b.latestSeq &&
  a.syncBlocked === b.syncBlocked &&
  a.pending === b.pending;

// Runs for as long as the scope is open. Closing it drops the port, stops
// the clock and the store subscriptions, and tells anyone still waiting on a
// barrier that the frame is gone.
export const makeSandboxClient = (
  rack: RackSource,
  {
    now = () => Date.now(),
    tickMs = 250,
    status = sandboxStatus,
    onLost,
  }: SandboxClientOptions = {},
): Effect.Effect<SandboxClient, never, Scope.Scope> =>
  Effect.gen(function* () {
    const first = rack.getState();
    let ledger = initialLedger(first, first.workSeq, now());
    let port: HostPort | undefined;
    let gen = 0;
    let nextBarrier = 0;
    const barriers = new Map<string, Deferred.Deferred<BarrierResult>>();

    // Inputs are handled one at a time, in order, even when handling one
    // leads to another, as posting a batch leads to Posted.
    const inbox: LedgerInput[] = [];
    let feeding = false;

    const handle = (out: LedgerOutput) => {
      if (out.post !== undefined) {
        try {
          if (port === undefined) throw new Error("No sandbox frame");
          port.postMessage(out.post);
          inbox.push({ _tag: "Posted", batchId: out.post.batchId });
        } catch (cause) {
          inbox.push({
            _tag: "PostFailed",
            batchId: out.post.batchId,
            cause: String(cause),
          });
        }
      }
      for (const { id, result } of out.resolved) {
        const waiting = barriers.get(id);
        barriers.delete(id);
        if (waiting !== undefined)
          Deferred.doneUnsafe(waiting, Effect.succeed(result));
      }
      for (const change of out.errorChanges) {
        if (change._tag === "Set") {
          const { kind, id, message } = change.entry;
          console.warn(`Sandbox ${kind} ${id}: ${message}`);
        }
      }
      if (out.lost === true) {
        drop();
        onLost?.();
      }
    };

    const feed = (input: LedgerInput) => {
      inbox.push(input);
      if (feeding) return;
      feeding = true;
      try {
        for (
          let next = inbox.shift();
          next !== undefined;
          next = inbox.shift()
        ) {
          const out = step(ledger, next);
          ledger = out.ledger;
          handle(out);
        }
      } finally {
        feeding = false;
      }
      const held = status.getState();
      const next = statusOf(ledger, held);
      if (!sameStatus(held, next)) status.setState(next, true);
    };

    const drop = () => {
      if (port === undefined) return;
      port.onmessage = null;
      port.close();
      port = undefined;
    };

    const receive = (event: MessageEvent<unknown>) => {
      const reply = event.data;
      // The frame runs code the app did not write, so anything it says that
      // the protocol does not allow is ignored.
      if (!isReply(reply)) return;
      switch (reply.type) {
        case "audio":
          status.setState({ audio: reply.state });
          return;
        case "batchResult":
          feed({ _tag: "Replied", result: reply });
          return;
        case "playback":
          feed({ _tag: "PlaybackReported", report: reply });
          return;
      }
    };

    // Rack changes, then the triggers that came with them, as the store
    // tells them.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        rack.subscribe((state, previous) => {
          if (state.rev !== previous.rev)
            feed({ _tag: "DesiredChanged", state, workSeq: state.workSeq });
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        rack.onWork((work) => {
          for (const one of work) feed({ _tag: "WorkAccepted", work: one });
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    yield* Effect.sync(() => feed({ _tag: "Tick", now: now() })).pipe(
      Effect.repeat(Schedule.spaced(tickMs)),
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        drop();
        for (const waiting of barriers.values())
          Deferred.doneUnsafe(
            waiting,
            Effect.succeed({ _tag: "Disconnected" } as const),
          );
        barriers.clear();
        status.setState(initialSandboxStatus, true);
      }),
    );

    return {
      connect: (next) => {
        drop();
        port = next;
        gen += 1;
        next.onmessage = receive;
        feed({ _tag: "Connected", gen });
      },

      barrier: (timeoutMs) =>
        Effect.suspend(() => {
          nextBarrier += 1;
          const id = `barrier-${nextBarrier}`;
          const waiting = Deferred.makeUnsafe<BarrierResult>();
          barriers.set(id, waiting);
          feed({
            _tag: "BarrierOpened",
            id,
            workSeq: rack.getState().workSeq,
            deadline: now() + timeoutMs,
          });
          return Deferred.await(waiting).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                barriers.delete(id);
                feed({ _tag: "BarrierCancelled", id });
              }),
            ),
          );
        }),

      setVisible: (visible) => feed({ _tag: "VisibilityChanged", visible }),
    };
  });
