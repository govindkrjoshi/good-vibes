import { Cause, Effect, Exit } from "effect";
import type * as ToneJs from "tone";
import { rootRack, Tone, type LeafError, type RackState } from "../rack/model";
import {
  makeToneRuntime,
  type PatchError,
  type ToneRuntime,
} from "../rack/renderer";
import {
  isRequest,
  type AudioState,
  type Command,
  type CommandError,
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

const emptyRack: RackState = {
  blocks: { [rootRack.id]: rootRack },
  jacks: {},
  params: {},
  methods: {},
  values: {},
  automations: {},
  patches: {},
  events: {},
  transport: { bpm: 120 },
  rootId: rootRack.id,
};

const run = (
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

// Why a command failed, as plain data the app can read back.
const describe = (exit: Exit.Exit<void, unknown>): CommandError | undefined => {
  if (Exit.isSuccess(exit)) return undefined;
  const error = Cause.squash(exit.cause);
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error._tag === "LeafError" || error._tag === "PatchError") &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { _tag: error._tag, message: error.message };
  }
  return {
    _tag: "LeafError",
    message: error instanceof Error ? error.message : String(error),
  };
};

// Builds the rack's Tone.js graph here, in the frame, from the requests that
// arrive on its port: each one brings what changed in the rack and a command
// for the runtime, which reads the rack as it now stands. Requests are carried
// out one at a time, in the order they came, and each is answered.
//
// The frame has one host, and so one graph, for as long as it lives. The app
// may hand it a new port, as when the provider mounts again; the newest port
// is the only one listened to, and the app sends it the whole rack.
export const makeRackHost = (
  tone: typeof ToneJs,
  { startAudio }: Options = {},
) => {
  let state = emptyRack;
  const runtime = Effect.runSync(
    makeToneRuntime(() => state).pipe(Effect.provideService(Tone, tone)),
  );
  let queue: Promise<void> = Promise.resolve();
  let current: FramePort | undefined;

  const attach = (port: FramePort) => {
    if (current !== undefined) current.onmessage = null;
    current = port;

    port.onmessage = (event) => {
      const request = event.data;
      // The app is the only one holding the other end, but a message that
      // does not fit is still dropped rather than half applied.
      if (!isRequest(request)) return;

      queue = queue.then(async () => {
        state = { ...state, ...request.changes };
        if (request.command.name === "render") startAudio?.();
        const exit = await Effect.runPromiseExit(run(runtime, request.command));
        const error = describe(exit);
        port.postMessage(
          error === undefined
            ? { type: "result", id: request.id }
            : { type: "result", id: request.id, error },
        );
      });
    };
  };

  // Tells the app, over the port it is listening on, how audio is doing.
  const report = (audio: AudioState) =>
    current?.postMessage({ type: "audio", state: audio });

  return { runtime, attach, report, state: () => state };
};
