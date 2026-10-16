import { Schema, Struct } from "effect";
import {
  rackStateKeys,
  RackStateSchema,
  renderErrorCodes,
  type RackState,
} from "../rack/model";

// How the app and the sandbox frame talk. The frame has an opaque origin, so
// its messages cannot be told apart by origin: the app only listens to the
// frame's own window, then hands it one end of a MessageChannel, and from
// then on the two only talk over that port. Every message is checked against
// these schemas on arrival, in both directions, and anything else is dropped.

// --- Over the window, until the port is handed over ------------------------

// `boot` is new each time the frame loads, so the app can tell a frame that
// loaded again, and needs connecting again, from one answering a ping twice.
const FrameReadySchema = Schema.Struct({
  channel: Schema.Literal("good-vibes:sandbox"),
  type: Schema.Literal("ready"),
  boot: Schema.String,
});

const HostHelloSchema = Schema.Struct({
  channel: Schema.Literal("good-vibes:sandbox"),
  type: Schema.Literals(["ping", "connect"]),
});

export type FrameReady = Schema.Schema.Type<typeof FrameReadySchema>;
export type HostHello = Schema.Schema.Type<typeof HostHelloSchema>;

export const isFrameReady = Schema.is(FrameReadySchema);
export const isHostHello = Schema.is(HostHelloSchema);

export const frameReady = (boot: string): FrameReady => ({
  channel: "good-vibes:sandbox",
  type: "ready",
  boot,
});
export const hostPing: HostHello = {
  channel: "good-vibes:sandbox",
  type: "ping",
};
// Sent with the frame's end of the channel as its one transferred port.
export const hostConnect: HostHello = {
  channel: "good-vibes:sandbox",
  type: "connect",
};

// --- Over the port ---------------------------------------------------------

const ParamValueSchema = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
]);

// The runtime's commands (see RackRuntime), by name.
const CommandSchema = Schema.Union([
  Schema.Struct({
    name: Schema.Literals(["render", "stop", "updateTransport"]),
  }),
  Schema.Struct({
    name: Schema.Literals(["addBlock", "deleteBlock"]),
    blockId: Schema.String,
  }),
  Schema.Struct({
    name: Schema.Literals(["addPatch", "deletePatch"]),
    patchId: Schema.String,
  }),
  Schema.Struct({
    name: Schema.Literal("updateParam"),
    paramId: Schema.String,
  }),
  Schema.Struct({
    name: Schema.Literals(["updateEvent", "updateEventLive", "deleteEvent"]),
    eventId: Schema.String,
  }),
  Schema.Struct({
    name: Schema.Literal("runLeafMethod"),
    methodId: Schema.String,
    args: Schema.Record(Schema.String, ParamValueSchema),
  }),
]);

export type Command = Schema.Schema.Type<typeof CommandSchema>;

// Only the parts of the rack that changed since the last batch; the frame
// keeps the rest from before.
const RackChangesSchema = RackStateSchema.mapFields(
  Struct.map(Schema.optionalKey),
);

export type RackChanges = Schema.Schema.Type<typeof RackChangesSchema>;

// Whether the frame's audio is playing. "suspended" means the browser would
// not let it start without a click in the frame itself.
const AudioStateSchema = Schema.Literals(["running", "suspended", "closed"]);

export type AudioState = Schema.Schema.Type<typeof AudioStateSchema>;

const AudioSchema = Schema.Struct({
  type: Schema.Literal("audio"),
  state: AudioStateSchema,
});

// --- Batches ---------------------------------------------------------------
//
// The app sends one batch at a time: the rack's changes since the last batch,
// then commands the frame carries out in order. It answers once all of them
// are done, with what each one did to each block, patch and event, and
// reports later, unprompted, any scheduled call that fails while playing.
// `gen` is the app's count of connections, echoed back so the app can tell
// an old frame's answers from the current one's.

const FailureSchema = Schema.Struct({
  code: Schema.Literals(renderErrorCodes),
  message: Schema.String,
});

export type Failure = Schema.Schema.Type<typeof FailureSchema>;

const BatchSchema = Schema.Struct({
  v: Schema.Literal(2),
  type: Schema.Literal("batch"),
  gen: Schema.Number,
  batchId: Schema.Number,
  changes: RackChangesSchema,
  commands: Schema.Array(
    Schema.Struct({ cmdId: Schema.Number, command: CommandSchema }),
  ),
});

export type Batch = Schema.Schema.Type<typeof BatchSchema>;

export const isBatch = Schema.is(BatchSchema);

// What a command did to one block, patch or event: built it, failed to build
// it, or took it away.
const EntityResultSchema = Schema.Struct({
  entity: Schema.Literals(["block", "patch", "event"]),
  id: Schema.String,
  removed: Schema.optionalKey(Schema.Boolean),
  failure: Schema.optionalKey(FailureSchema),
});

export type EntityResult = Schema.Schema.Type<typeof EntityResultSchema>;

const CommandResultSchema = Schema.Struct({
  cmdId: Schema.Number,
  // Why the command as a whole failed, if it did.
  failure: Schema.optionalKey(FailureSchema),
  entities: Schema.Array(EntityResultSchema),
});

export type CommandResult = Schema.Schema.Type<typeof CommandResultSchema>;

const BatchResultSchema = Schema.Struct({
  v: Schema.Literal(2),
  type: Schema.Literal("batchResult"),
  gen: Schema.Number,
  batchId: Schema.Number,
  results: Schema.Array(CommandResultSchema),
});

export type BatchResult = Schema.Schema.Type<typeof BatchResultSchema>;

// A scheduled call that failed while playing. `scheduleCmdId` is the command
// that built the schedule it belongs to.
const PlaybackSchema = Schema.Struct({
  v: Schema.Literal(2),
  type: Schema.Literal("playback"),
  gen: Schema.Number,
  eventId: Schema.String,
  scheduleCmdId: Schema.Number,
  message: Schema.String,
});

export type Playback = Schema.Schema.Type<typeof PlaybackSchema>;

const ReplySchema = Schema.Union([
  AudioSchema,
  BatchResultSchema,
  PlaybackSchema,
]);

export type Reply = Schema.Schema.Type<typeof ReplySchema>;

export const isReply = Schema.is(ReplySchema);

// The parts of the rack in `next` that are not the same objects as in
// `previous`. The store never mutates its state, so an unchanged part is the
// same object. Anything else `next` holds, like the store's actions, is left
// out: only the rack's data can be sent.
export const rackChanges = (
  previous: RackState | undefined,
  next: RackState,
): RackChanges =>
  Object.fromEntries(
    rackStateKeys
      .filter((key) => previous === undefined || previous[key] !== next[key])
      .map((key) => [key, next[key]]),
  );
