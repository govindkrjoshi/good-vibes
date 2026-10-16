import { entityChanges, transportId, type EntityKind } from "../rack/entities";
import { rootRack, type RackState } from "../rack/model";
import { initialRackMeta, type RackMeta, type Stamp } from "../rack/reduce";
import type { Command } from "./protocol";

// Works out the commands that take the frame from the rack it was last sent
// to the rack as it is now. Pure: it reads two snapshots and what is known to
// have failed, and says what to send. See the migration plan's contract C2.
//
// Rules, in short:
// - An id whose incarnation changed is a replacement: deleted, then added,
//   even when its data looks the same.
// - A leaf is rebuilt when its code or jacks change, when it was retried, or
//   when it failed to build and any of its inputs (the block or its params)
//   changed. A failure that has not changed is not retried on its own.
// - Rebuilding a block brings back every patch on it. The frame schedules a
//   rebuilt leaf's events itself, so they get no command of their own.
// - A sequence whose steps alone changed is updated live, unless its last
//   schedule failed.
// - Commands go out in a fixed order: patch, event and block removals, then
//   block builds, patches, params, events and the transport.

// What the frame was last sent, or will be. A store's state is one.
export type Snapshot = RackState & Pick<RackMeta, "stamps" | "incarnations">;

// The frame with nothing sent to it yet.
export const emptySnapshot: Snapshot = {
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
  stamps: initialRackMeta.stamps,
  incarnations: initialRackMeta.incarnations,
};

// The ways a block, patch, param or event can fail in the frame.
export type ErrorKind =
  "build" | "connect" | "param" | "schedule" | "play" | "playback";

export type Target = {
  readonly entity: EntityKind;
  readonly id: string;
  readonly incarnation?: string;
};

// The change that made a command necessary.
export type Cause = {
  readonly rev: number;
  readonly envelopeId: string;
  readonly entity: EntityKind;
  readonly id: string;
};

export type Planned = {
  readonly command: Command;
  readonly target: Target;
  // What a failure of the command as a whole counts against, if anything.
  readonly errorKind?: ErrorKind;
  readonly cause?: Cause;
};

// Whether the frame last reported this entity as failed.
export type Failed = (kind: ErrorKind, id: string) => boolean;

export type Forced = {
  readonly entity: "block" | "patch" | "event";
  readonly id: string;
  readonly cause?: Cause;
};

const causeOf = (
  state: Snapshot,
  entity: EntityKind,
  id: string,
): Cause | undefined => {
  const stamp: Stamp | undefined = state.stamps[entity][id];
  return stamp === undefined
    ? undefined
    : { rev: stamp.rev, envelopeId: stamp.envelopeId, entity, id };
};

const target = (state: Snapshot, entity: EntityKind, id: string): Target => {
  const incarnation = state.incarnations[entity][id];
  return incarnation === undefined
    ? { entity, id }
    : { entity, id, incarnation };
};

const blockOfJack = (state: RackState, jackId: string) =>
  state.jacks[jackId]?.belongToBlockId;

// Everything about an event but its steps, to tell a live step edit apart.
const withoutSteps = (event: object) =>
  JSON.stringify({ ...event, steps: undefined });

export const commandsFor = (
  prev: Snapshot,
  next: Snapshot,
  failed: Failed = () => false,
  forced: readonly Forced[] = [],
): Planned[] => {
  const changes = entityChanges(prev, next);
  const replaced = (entity: EntityKind) =>
    Object.keys(next.incarnations[entity]).filter(
      (id) =>
        id in prev.incarnations[entity] &&
        prev.incarnations[entity][id] !== next.incarnations[entity][id],
    );
  const forcedOf = (entity: Forced["entity"]) =>
    forced.filter((one) => one.entity === entity);
  const unique = (ids: Iterable<string>) => [...new Set(ids)];

  // --- Removals -----------------------------------------------------------

  // A removal has no stamp of its own left; the block that held it changed
  // in the same message, so it stands for the cause.
  const removalCause = (holder: string | undefined) =>
    causeOf(next, "block", holder ?? next.rootId) ??
    causeOf(next, "block", next.rootId);

  const replacedBlocks = replaced("block");
  const replacedPatches = replaced("patch");
  const replacedEvents = replaced("event");

  const patchRemovals = unique([
    ...changes.patch.removed,
    ...replacedPatches,
  ]).map((id): Planned => ({
    command: { name: "deletePatch", patchId: id },
    target: target(prev, "patch", id),
    cause: removalCause(next.rootId),
  }));
  const eventRemovals = unique([
    ...changes.event.removed,
    ...replacedEvents,
  ]).map((id): Planned => ({
    command: { name: "deleteEvent", eventId: id },
    target: target(prev, "event", id),
    cause: removalCause(prev.events[id]?.belongToBlockId),
  }));
  const blockRemovals = unique([
    ...changes.block.removed,
    ...replacedBlocks,
  ]).map((id): Planned => ({
    command: { name: "deleteBlock", blockId: id },
    target: target(prev, "block", id),
    cause: removalCause(next.rootId),
  }));

  // --- Blocks to build ----------------------------------------------------

  const changedParams = changes.param.changed;
  const paramsOf = (blockId: string) =>
    changedParams.filter(
      (paramId) => next.params[paramId]?.belongToBlockId === blockId,
    );

  // Why a block in `next` has to be built, if it does.
  const buildCause = (id: string): Cause | undefined | false => {
    const block = next.blocks[id];
    if (block === undefined || id === next.rootId) return false;
    const was = prev.blocks[id];

    if (was === undefined || replacedBlocks.includes(id))
      return causeOf(next, "block", id);
    const retried = forcedOf("block").find((one) => one.id === id);
    if (retried !== undefined) return retried.cause;
    if (block.type !== "leaf" || was.type !== "leaf") return false;

    if (block.code !== was.code || block.jackIds !== was.jackIds)
      return causeOf(next, "block", id);
    if (failed("build", id)) {
      const param = paramsOf(id).at(-1);
      if (param !== undefined) return causeOf(next, "param", param);
      if (block !== was) return causeOf(next, "block", id);
    }
    return false;
  };

  const builds = Object.keys(next.blocks).flatMap((id): Planned[] => {
    const cause = buildCause(id);
    if (cause === false) return [];
    return [
      {
        command: { name: "addBlock", blockId: id },
        target: target(next, "block", id),
        errorKind: "build",
        ...(cause === undefined ? {} : { cause }),
      },
    ];
  });
  const built = new Map(builds.map((one) => [one.target.id, one.cause]));

  // --- Patches ------------------------------------------------------------

  const patches = Object.entries(next.patches).flatMap(
    ([id, patch]): Planned[] => {
      const ends = [blockOfJack(next, patch.from), blockOfJack(next, patch.to)];
      const rebuiltEnd = ends.find(
        (end) => end !== undefined && built.has(end),
      );
      const retried = forcedOf("patch").find((one) => one.id === id);

      const cause =
        changes.patch.added.includes(id) ||
        changes.patch.changed.includes(id) ||
        replacedPatches.includes(id)
          ? causeOf(next, "patch", id)
          : rebuiltEnd !== undefined
            ? built.get(rebuiltEnd)
            : retried !== undefined
              ? retried.cause
              : false;
      if (cause === false) return [];
      return [
        {
          command: { name: "addPatch", patchId: id },
          target: target(next, "patch", id),
          errorKind: "connect",
          ...(cause === undefined ? {} : { cause }),
        },
      ];
    },
  );

  // --- Params -------------------------------------------------------------

  const params = changedParams
    .filter((id) => {
      const owner = next.params[id]?.belongToBlockId;
      return owner !== undefined && !built.has(owner);
    })
    .map((id): Planned => ({
      command: { name: "updateParam", paramId: id },
      target: target(next, "param", id),
      errorKind: "param",
      ...(causeOf(next, "param", id) === undefined
        ? {}
        : { cause: causeOf(next, "param", id) }),
    }));

  // --- Events -------------------------------------------------------------

  const events = Object.entries(next.events).flatMap(
    ([id, event]): Planned[] => {
      // A rebuilt leaf schedules its own events.
      if (built.has(event.belongToBlockId)) return [];
      const retried = forcedOf("event").find((one) => one.id === id);
      const added =
        changes.event.added.includes(id) || replacedEvents.includes(id);
      const changed = changes.event.changed.includes(id);
      if (!added && !changed && retried === undefined) return [];

      const was = prev.events[id];
      const live =
        !added &&
        retried === undefined &&
        event.kind === "sequence" &&
        was?.kind === "sequence" &&
        !failed("schedule", id) &&
        withoutSteps(was) === withoutSteps(event);
      const cause =
        added || changed ? causeOf(next, "event", id) : retried?.cause;

      return [
        {
          command: {
            name: live ? "updateEventLive" : "updateEvent",
            eventId: id,
          },
          target: target(next, "event", id),
          errorKind: "schedule",
          ...(cause === undefined ? {} : { cause }),
        },
      ];
    },
  );

  // --- Transport ----------------------------------------------------------

  const transport: Planned[] =
    changes.transport.changed.length === 0
      ? []
      : [
          {
            command: { name: "updateTransport" },
            target: { entity: "transport", id: transportId },
            ...(causeOf(next, "transport", transportId) === undefined
              ? {}
              : { cause: causeOf(next, "transport", transportId) }),
          },
        ];

  return [
    ...patchRemovals,
    ...eventRemovals,
    ...blockRemovals,
    ...builds,
    ...patches,
    ...params,
    ...events,
    ...transport,
  ];
};
