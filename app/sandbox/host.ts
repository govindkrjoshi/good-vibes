import { Cause, Effect, Exit } from "effect";
import type * as ToneJs from "tone";
import {
  initialRackState,
  Tone,
  type LeafError,
  type RackState,
  type RenderErrorCode,
} from "../rack/model";
import {
  makeToneRuntime,
  type PatchError,
  type RenderedRackState,
  type ToneRuntime,
} from "../rack/renderer";
import {
  isBatch,
  type AudioState,
  type Batch,
  type Command,
  type CommandResult,
  type EntityResult,
  type Failure,
  type Reply,
} from "./protocol";

// The sandbox frame's end of the channel.
export type FramePort = {
  postMessage(message: Reply): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};

type Options = {
  // Called as a render starts. Audio can only start from a user gesture, and
  // the frame decides how to get one.
  readonly startAudio?: () => void;
};

// Carries out one command on the runtime.
export const runCommand = (
  runtime: ToneRuntime,
  command: Command,
): Effect.Effect<void, LeafError | PatchError> => {
  switch (command.name) {
    case "render":
      return runtime.render;
    case "stop":
      return runtime.stop;
    case "updateTransport":
      return runtime.updateTransport;
    case "addBlock":
      return runtime.addBlock(command.blockId);
    case "deleteBlock":
      return runtime.deleteBlock(command.blockId);
    case "addPatch":
      return runtime.addPatch(command.patchId);
    case "deletePatch":
      return runtime.deletePatch(command.patchId);
    case "updateParam":
      return runtime.updateParam(command.paramId);
    case "updateEvent":
      return runtime.updateEvent(command.eventId);
    case "updateEventLive":
      return runtime.updateEventLive(command.eventId);
    case "deleteEvent":
      return runtime.deleteEvent(command.eventId);
    case "runLeafMethod":
      return runtime.runLeafMethod(command.methodId, command.args);
  }
};

const isTagged = (
  error: unknown,
): error is {
  readonly _tag: "LeafError" | "PatchError";
  readonly message: string;
  readonly code?: RenderErrorCode;
} =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error._tag === "LeafError" || error._tag === "PatchError") &&
  "message" in error &&
  typeof error.message === "string";

// Why a command failed, as plain data with a code. Anything without one of
// its own gets the code that fits what failed.
const failureOf = (
  exit: Exit.Exit<unknown, unknown>,
  fallback: RenderErrorCode,
): Failure | undefined => {
  if (Exit.isSuccess(exit)) return undefined;
  const error = Cause.squash(exit.cause);
  if (isTagged(error))
    return { code: error.code ?? fallback, message: error.message };
  return {
    code: fallback,
    message: error instanceof Error ? error.message : String(error),
  };
};

// What a command did to each block, patch and event, read off the rendered
// graph before and after it: whatever was built again, and whatever is gone.
const entityResults = (
  before: RenderedRackState,
  after: RenderedRackState,
): EntityResult[] => {
  const compare = <T>(
    entity: EntityResult["entity"],
    was: ReadonlyMap<string, T>,
    is: ReadonlyMap<string, T>,
    failure: (value: T) => Failure | undefined,
  ): EntityResult[] => [
    ...[...is].flatMap(([id, value]): EntityResult[] => {
      if (was.get(id) === value) return [];
      const failed = failure(value);
      return [
        failed === undefined ? { entity, id } : { entity, id, failure: failed },
      ];
    }),
    ...[...was.keys()]
      .filter((id) => !is.has(id))
      .map((id): EntityResult => ({ entity, id, removed: true })),
  ];

  return [
    ...compare("block", before.blocks, after.blocks, (block) =>
      block.kind === "leaf" ? failureOf(block.exit, "LeafThrew") : undefined,
    ),
    ...compare("patch", before.patches, after.patches, (patch) =>
      failureOf(patch.exit, "PatchFailed"),
    ),
    ...compare("event", before.events, after.events, (event) =>
      failureOf(event.exit, "ScheduleFailed"),
    ),
  ];
};

// The code for a command that failed as a whole, when its error has none.
const commandFallback = (command: Command): RenderErrorCode => {
  switch (command.name) {
    case "addPatch":
    case "deletePatch":
      return "PatchFailed";
    case "updateParam":
      return "ParamRejected";
    case "updateEvent":
    case "updateEventLive":
    case "deleteEvent":
      return "ScheduleFailed";
    case "runLeafMethod":
      return "MethodThrew";
    default:
      return "LeafThrew";
  }
};

// Builds the rack's Tone.js graph here, in the frame, from the batches that
// arrive on its port: each brings what changed in the rack and commands for
// the runtime, which reads the rack as it now stands. Batches are carried out
// one at a time, in the order they came, each command in order, and each
// batch is answered once all of it is done.
//
// The frame has one host, and so one graph, for as long as it lives. The app
// may hand it a new port, as when the provider mounts again; the newest port
// is the only one listened to.
export const makeRackHost = (
  tone: typeof ToneJs,
  { startAudio }: Options = {},
) => {
  let state: RackState = initialRackState;
  let current: FramePort | undefined;
  // For each event, the schedule it plays now and the batch command that
  // built it, so a failure while playing can name that command. A failure
  // from any older schedule is not reported.
  const schedules = new Map<
    string,
    { readonly schedule: number; readonly gen: number; readonly cmdId: number }
  >();

  const runtime = Effect.runSync(
    makeToneRuntime(() => state, {
      onPlaybackFailure: ({ eventId, schedule, message }) => {
        const built = schedules.get(eventId);
        if (built === undefined || built.schedule !== schedule) return;
        current?.postMessage({
          v: 2,
          type: "playback",
          gen: built.gen,
          eventId,
          scheduleCmdId: built.cmdId,
          message,
        });
      },
    }).pipe(Effect.provideService(Tone, tone)),
  );
  let queue: Promise<void> = Promise.resolve();

  const runBatch = async (port: FramePort, batch: Batch) => {
    state = { ...state, ...batch.changes };
    const results: CommandResult[] = [];
    for (const { cmdId, command } of batch.commands) {
      if (command.name === "render") startAudio?.();
      const before = await Effect.runPromise(runtime.rendered);
      const exit = await Effect.runPromiseExit(runCommand(runtime, command));
      const after = await Effect.runPromise(runtime.rendered);

      const entities = entityResults(before, after);
      for (const result of entities) {
        if (result.entity !== "event") continue;
        const event = after.events.get(result.id);
        if (event === undefined) schedules.delete(result.id);
        else
          schedules.set(result.id, {
            schedule: event.schedule,
            gen: batch.gen,
            cmdId,
          });
      }
      const failure = failureOf(exit, commandFallback(command));
      results.push(
        failure === undefined
          ? { cmdId, entities }
          : { cmdId, failure, entities },
      );
    }
    port.postMessage({
      v: 2,
      type: "batchResult",
      gen: batch.gen,
      batchId: batch.batchId,
      results,
    });
  };

  // A new port is an app connecting afresh, which sends the whole rack in
  // its first batch, so whatever the graph holds from before is thrown away
  // first rather than left playing.
  const attach = (port: FramePort) => {
    if (current !== undefined) current.onmessage = null;
    current = port;
    queue = queue.then(async () => {
      schedules.clear();
      state = initialRackState;
      await Effect.runPromise(runtime.reset);
    });

    port.onmessage = (event) => {
      const request = event.data;
      // The app is the only one holding the other end, but a message that
      // does not fit is dropped rather than half applied.
      if (!isBatch(request)) return;
      queue = queue.then(() => runBatch(port, request));
    };
  };

  // Tells the app, over the port it is listening on, how audio is doing.
  const report = (audio: AudioState) =>
    current?.postMessage({ type: "audio", state: audio });

  return { runtime, attach, report, state: () => state };
};
