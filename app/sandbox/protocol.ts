import { Schema, Struct } from "effect";
import { rackStateKeys, RackStateSchema, type RackState } from "../rack/model";

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

// Only the parts of the rack that changed since the last request; the frame
// keeps the rest from before.
const RackChangesSchema = RackStateSchema.mapFields(
  Struct.map(Schema.optionalKey),
);

export type RackChanges = Schema.Schema.Type<typeof RackChangesSchema>;

const RequestSchema = Schema.Struct({
  type: Schema.Literal("request"),
  id: Schema.Number,
  changes: RackChangesSchema,
  command: CommandSchema,
});

export type Request = Schema.Schema.Type<typeof RequestSchema>;

export const isRequest = Schema.is(RequestSchema);

const CommandErrorSchema = Schema.Struct({
  _tag: Schema.Literals(["LeafError", "PatchError"]),
  message: Schema.String,
});

export type CommandError = Schema.Schema.Type<typeof CommandErrorSchema>;

// The answer to the request with the same id: done, or why it failed.
const ResultSchema = Schema.Struct({
  type: Schema.Literal("result"),
  id: Schema.Number,
  error: Schema.optionalKey(CommandErrorSchema),
});

// Whether the frame's audio is playing. "suspended" means the browser would
// not let it start without a click in the frame itself.
const AudioStateSchema = Schema.Literals(["running", "suspended", "closed"]);

export type AudioState = Schema.Schema.Type<typeof AudioStateSchema>;

const AudioSchema = Schema.Struct({
  type: Schema.Literal("audio"),
  state: AudioStateSchema,
});

const ReplySchema = Schema.Union([ResultSchema, AudioSchema]);

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
