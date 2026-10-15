import { Effect } from "effect";
import { LeafError, type RackState } from "../rack/model";
import { PatchError, type RackRuntime } from "../rack/renderer";
import {
  isReply,
  rackChanges,
  type AudioState,
  type Command,
  type CommandError,
  type Request,
} from "./protocol";

// The end of a MessageChannel the app keeps.
export type HostPort = {
  postMessage(message: Request): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  close(): void;
};

export type SandboxClient = {
  // The store's runtime: every command is sent to the frame, with whatever
  // changed in the rack since the last one, and finishes when the frame has
  // carried it out.
  readonly runtime: RackRuntime;
  // Talks to a frame over this port from now on. A frame that loads again,
  // as after a reload, starts with no rack, so it is sent the whole rack.
  readonly connect: (port: HostPort) => void;
  readonly onAudio: (listener: (state: AudioState) => void) => () => void;
  readonly close: () => void;
};

type Pending = {
  readonly command: Command;
  readonly state: RackState;
  readonly settle: (error: LeafError | PatchError | undefined) => void;
};

const toError = (error: CommandError) =>
  error._tag === "PatchError"
    ? new PatchError({ message: error.message })
    : new LeafError({ message: error.message });

export const makeSandboxClient = (getState: () => RackState): SandboxClient => {
  let port: HostPort | undefined;
  let nextId = 0;
  // What the current frame was last sent, to work out what changed since.
  let sent: RackState | undefined;
  // Commands made before any frame was connected, in order.
  const queued: Pending[] = [];
  // Commands the current frame has not answered yet, by request id.
  const waiting = new Map<number, Pending>();
  const listeners = new Set<(state: AudioState) => void>();

  const send = (target: HostPort, pending: Pending) => {
    const id = nextId++;
    try {
      target.postMessage({
        type: "request",
        id,
        changes: rackChanges(sent, pending.state),
        command: pending.command,
      });
    } catch (cause) {
      // The rack held something that cannot be cloned; the frame has not
      // seen it, so the next request sends the same changes again.
      pending.settle(
        new LeafError({
          message: `Could not reach the sandbox: ${String(cause)}`,
        }),
      );
      return;
    }
    sent = pending.state;
    waiting.set(id, pending);
  };

  // Only what the protocol allows is read; the frame runs code the app did
  // not write, so anything else it says is ignored.
  const receive = (event: MessageEvent<unknown>) => {
    const reply = event.data;
    if (!isReply(reply)) return;

    if (reply.type === "audio") {
      for (const listener of listeners) listener(reply.state);
      return;
    }

    const pending = waiting.get(reply.id);
    if (pending === undefined) return;
    waiting.delete(reply.id);
    pending.settle(
      reply.error === undefined ? undefined : toError(reply.error),
    );
  };

  // A frame that goes away takes its graph with it, so whatever it still owed
  // an answer to fails rather than hanging.
  const abandon = () => {
    for (const pending of waiting.values()) {
      pending.settle(new LeafError({ message: "The sandbox frame went away" }));
    }
    waiting.clear();
  };

  const request = (
    command: Command,
  ): Effect.Effect<void, LeafError | PatchError> =>
    Effect.callback<void, LeafError | PatchError>((resume) => {
      const pending: Pending = {
        command,
        // Read when the command runs, as a renderer in this frame would.
        state: getState(),
        settle: (error) =>
          resume(error === undefined ? Effect.void : Effect.fail(error)),
      };
      if (port === undefined) queued.push(pending);
      else send(port, pending);
    });

  const runtime: RackRuntime = {
    render: request({ name: "render" }).pipe(Effect.orDie),
    addBlock: (blockId) =>
      request({ name: "addBlock", blockId }).pipe(
        Effect.catchTag("PatchError", Effect.die),
      ),
    deleteBlock: (blockId) =>
      request({ name: "deleteBlock", blockId }).pipe(Effect.orDie),
    addPatch: (patchId) =>
      request({ name: "addPatch", patchId }).pipe(
        Effect.catchTag("LeafError", Effect.die),
      ),
    deletePatch: (patchId) =>
      request({ name: "deletePatch", patchId }).pipe(Effect.orDie),
    updateParam: (paramId) =>
      request({ name: "updateParam", paramId }).pipe(
        Effect.catchTag("PatchError", Effect.die),
      ),
    runLeafMethod: (methodId, args) =>
      request({ name: "runLeafMethod", methodId, args }).pipe(
        Effect.catchTag("PatchError", Effect.die),
      ),
    updateEvent: (eventId) =>
      request({ name: "updateEvent", eventId }).pipe(
        Effect.catchTag("PatchError", Effect.die),
      ),
    updateEventLive: (eventId) =>
      request({ name: "updateEventLive", eventId }).pipe(
        Effect.catchTag("PatchError", Effect.die),
      ),
    deleteEvent: (eventId) =>
      request({ name: "deleteEvent", eventId }).pipe(Effect.orDie),
    updateTransport: request({ name: "updateTransport" }).pipe(Effect.orDie),
    stop: request({ name: "stop" }).pipe(Effect.orDie),
  };

  return {
    runtime,

    connect: (next) => {
      if (port !== undefined) {
        port.onmessage = null;
        port.close();
      }
      abandon();
      port = next;
      sent = undefined;
      next.onmessage = receive;
      for (const pending of queued.splice(0)) send(next, pending);
    },

    onAudio: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close: () => {
      abandon();
      if (port !== undefined) {
        port.onmessage = null;
        port.close();
      }
      port = undefined;
      listeners.clear();
    },
  };
};
