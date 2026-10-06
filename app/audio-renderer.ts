import { Context, Data, Effect, Exit, Ref } from "effect";
import type * as ToneJs from "tone";
import type { RackState } from "./stores/rack";
import {
  noteArg,
  timeArg,
  type AutomationEvent,
  type LeafRack,
  type Method,
  type Param,
  type ParamGroup,
  type ParamValue,
  type RackEvent,
} from "./types/rack";

type ToneNode = ToneJs.ToneAudioNode;

// The Tone.js module, handed to leaf code as a service. The browser provides
// the real module; tests provide the same module running on a node audio
// context.
export class Tone extends Context.Service<Tone, typeof ToneJs>()("Tone") {}

export class LeafError extends Data.TaggedError("LeafError")<{
  readonly message: string;
}> {}

export class PatchError extends Data.TaggedError("PatchError")<{
  readonly message: string;
}> {}

// What a leaf block runs to make its Tone.js node. Param values are applied
// by the renderer afterwards, so the code only has to construct the node.
export type LeafCode = () => Effect.Effect<ToneNode, LeafError, Tone>;

export type RenderedLeaf = {
  readonly kind: "leaf";
  readonly blockId: string;
  readonly parentId: string | undefined;
  readonly exit: Exit.Exit<ToneNode, LeafError>;
};

// A tree has no Tone.js node of its own; it only groups the blocks and
// patches under it.
export type RenderedTree = {
  readonly kind: "tree";
  readonly blockId: string;
  readonly parentId: string | undefined;
};

export type RenderedBlock = RenderedLeaf | RenderedTree;

// The two leaves a patch joined. Kept here because by the time a patch is
// deleted, the store has already forgotten its jacks.
export type Connection = {
  readonly fromBlockId: string;
  readonly toBlockId: string;
};

export type RenderedPatch = {
  readonly patchId: string;
  readonly treeId: string;
  readonly exit: Exit.Exit<Connection, PatchError>;
};

// What Sequence, ToneEvent, Pattern and Part have in common, so one map can
// hold any of them.
export type ToneScheduled = {
  start(time?: ToneJs.Unit.Time): unknown;
  stop(time?: ToneJs.Unit.Time): unknown;
  dispose(): unknown;
  probability: number;
  humanize: boolean | ToneJs.Unit.Time;
  playbackRate: number;
  mute: boolean;
};

export type RenderedEvent = {
  readonly eventId: string;
  readonly blockId: string;
  readonly exit: Exit.Exit<ToneScheduled, LeafError>;
};

export type RenderedRackState = {
  readonly blocks: ReadonlyMap<string, RenderedBlock>;
  readonly patches: ReadonlyMap<string, RenderedPatch>;
  readonly events: ReadonlyMap<string, RenderedEvent>;
};

export type ToneRuntime = {
  readonly rendered: Effect.Effect<RenderedRackState>;
  // Throws away the whole graph and builds it again from the store.
  readonly render: Effect.Effect<void>;
  readonly addBlock: (blockId: string) => Effect.Effect<void, LeafError>;
  readonly deleteBlock: (blockId: string) => Effect.Effect<void>;
  readonly addPatch: (patchId: string) => Effect.Effect<void, PatchError>;
  readonly deletePatch: (patchId: string) => Effect.Effect<void>;
  // Re-applies a param's value and automation, after either changes.
  readonly updateParam: (paramId: string) => Effect.Effect<void, LeafError>;
  readonly runLeafMethod: (
    methodId: string,
    args: Readonly<Record<string, ParamValue>>,
  ) => Effect.Effect<void, LeafError>;
  // Builds an event again from the store, after it is added or changed.
  readonly updateEvent: (eventId: string) => Effect.Effect<void, LeafError>;
  // Hands a playing sequence its new steps without rebuilding it.
  readonly updateEventLive: (eventId: string) => Effect.Effect<void, LeafError>;
  readonly deleteEvent: (eventId: string) => Effect.Effect<void>;
  readonly updateTransport: Effect.Effect<void>;
  // Stops every event and rewinds the transport to the start.
  readonly stop: Effect.Effect<void>;
};

const empty: RenderedRackState = {
  blocks: new Map(),
  patches: new Map(),
  events: new Map(),
};

// For a store with no audio attached, such as in tests of the store itself.
export const noopRuntime: ToneRuntime = {
  rendered: Effect.succeed(empty),
  render: Effect.void,
  addBlock: () => Effect.void,
  deleteBlock: () => Effect.void,
  addPatch: () => Effect.void,
  deletePatch: () => Effect.void,
  updateParam: () => Effect.void,
  runLeafMethod: () => Effect.void,
  updateEvent: () => Effect.void,
  updateEventLive: () => Effect.void,
  deleteEvent: () => Effect.void,
  updateTransport: Effect.void,
  stop: Effect.void,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const makeToneRuntime = (
  getState: () => RackState,
): Effect.Effect<ToneRuntime, never, Tone> =>
  Effect.gen(function* () {
    const tone = yield* Tone;
    // Commands are not serialized. That is safe while leaf code builds its
    // node without waiting; once a leaf can wait (e.g. loading samples), a
    // command running meanwhile could leak a node, and they will need a lock.
    const ref = yield* Ref.make(empty);

    // Copies a map with one entry set, or removed when there is no value.
    const withEntry = <V>(
      map: ReadonlyMap<string, V>,
      id: string,
      value: V | undefined,
    ) => {
      const next = new Map(map);
      if (value === undefined) next.delete(id);
      else next.set(id, value);
      return next;
    };

    const putBlock = (blockId: string, block: RenderedBlock | undefined) =>
      Ref.update(ref, (state) => ({
        ...state,
        blocks: withEntry(state.blocks, blockId, block),
      }));

    const putPatch = (patchId: string, patch: RenderedPatch | undefined) =>
      Ref.update(ref, (state) => ({
        ...state,
        patches: withEntry(state.patches, patchId, patch),
      }));

    const putEvent = (eventId: string, event: RenderedEvent | undefined) =>
      Ref.update(ref, (state) => ({
        ...state,
        events: withEntry(state.events, eventId, event),
      }));

    // The node a rendered leaf built, or the error it failed with.
    const leafNode = (blockId: string) =>
      Effect.gen(function* () {
        const block = (yield* Ref.get(ref)).blocks.get(blockId);
        if (block?.kind !== "leaf") {
          return yield* new LeafError({
            message: `Block ${blockId} is not a rendered leaf`,
          });
        }
        return yield* block.exit;
      });

    // The destination leaf's node is Tone's shared output, which outlives
    // any rack, so it is never disconnected or disposed.
    const release = (node: ToneNode) => {
      if (node === tone.getDestination()) return;
      node.disconnect();
      node.dispose();
    };

    // --- Params -----------------------------------------------------------

    // Finds the object holding a param, e.g. `node.envelope` for the path
    // ["envelope", "attack"], so its last key can be read or written.
    const locate = (
      node: ToneNode,
      param: Param,
    ): Effect.Effect<
      { readonly owner: Record<string, unknown>; readonly key: string },
      LeafError
    > => {
      const owner = param.path
        .slice(0, -1)
        .reduce<unknown>(
          (value, key) => (isObject(value) ? value[key] : undefined),
          node,
        );
      const key = param.path.at(-1);

      return isObject(owner) && key !== undefined && key in owner
        ? Effect.succeed({ owner, key })
        : Effect.fail(
            new LeafError({ message: `No ${param.path.join(".")} on node` }),
          );
    };

    // Values that change at audio rate, like volume, are Param or Signal
    // objects. They are set through `.value` and can be automated.
    const isAudioParam = (
      value: unknown,
    ): value is ToneJs.Param | ToneJs.Signal =>
      value instanceof tone.Param || value instanceof tone.Signal;

    // Reads an automation time as seconds from now. A leading "+" is dropped
    // because every time is already relative to when the param is applied.
    const seconds = (target: ToneJs.Param | ToneJs.Signal, time: string) => {
      const value = target.toSeconds(time.trim().replace(/^\+/, ""));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`"${time}" is not a time`);
      }
      return value;
    };

    // Turns an automation event into a call on the param, with its times
    // worked out up front so that a bad one fails before anything changes.
    const plan = (
      target: ToneJs.Param | ToneJs.Signal,
      event: AutomationEvent,
      now: number,
    ): { readonly at: number; readonly schedule: () => void } => {
      const at = now + seconds(target, event.time);
      switch (event.method) {
        case "setValueAtTime":
          return { at, schedule: () => target.setValueAtTime(event.value, at) };
        case "rampTo": {
          // The editor always fills in a ramp time; "0.1" matches its default.
          const over = seconds(target, event.rampTime ?? "0.1");
          return { at, schedule: () => target.rampTo(event.value, over, at) };
        }
        case "linearRampToValueAtTime":
          return {
            at,
            schedule: () => target.linearRampToValueAtTime(event.value, at),
          };
        case "exponentialRampToValueAtTime":
          return {
            at,
            schedule: () =>
              target.exponentialRampToValueAtTime(event.value, at),
          };
      }
    };

    // Sets a param on the node to what the store holds. An audio param's value
    // and automation are both events on the same timeline, and clearing one
    // clears the other, so they are always applied together: clear, set the
    // value, then schedule the automation. Automation times count from now,
    // so applying a param again starts its automation over.
    const applyParam = (node: ToneNode, param: Param) =>
      Effect.flatMap(locate(node, param), ({ owner, key }) =>
        Effect.try({
          try: () => {
            const state = getState();
            const value = state.values[param.id] ?? param.defaultValue;
            const events = state.automations[param.id] ?? [];
            const target = owner[key];

            // Some params only exist in some setups, e.g. pulse width only on
            // a pulse oscillator. Tone reads those as undefined otherwise.
            if (target === undefined) return;

            if (isAudioParam(target)) {
              const now = target.now();
              // rampTo cancels later automation, so schedule by resolved time
              // rather than insertion order. Equal times keep their stored order.
              const scheduled = events
                .map((event) => plan(target, event, now))
                .sort((a, b) => a.at - b.at);
              target.cancelScheduledValues(0);
              target.value = value as number;
              for (const { schedule } of scheduled) schedule();
            } else {
              owner[key] = value;
            }
          },
          catch: (cause) =>
            new LeafError({
              message: `Could not set ${param.name}: ${String(cause)}`,
            }),
        }),
      );

    // A block's params in the order its template lists them, so that a param
    // that reshapes the node, like oscillator type, comes before the params
    // that only exist on the new shape, like pulse width.
    const blockParams = (group: ParamGroup): Param[] => [
      ...Object.values(group.paramIds ?? {}).flatMap((paramId) => {
        const param = getState().params[paramId];
        return param === undefined ? [] : [param];
      }),
      ...Object.values(group.groups ?? {}).flatMap(blockParams),
    ];

    const applyParams = (node: ToneNode, block: LeafRack) =>
      Effect.forEach(
        blockParams(block.paramIds),
        (param) => applyParam(node, param),
        { discard: true },
      );

    // --- Blocks -----------------------------------------------------------

    const buildLeaf = (block: LeafRack) =>
      Effect.gen(function* () {
        const node = yield* block
          .code()
          .pipe(Effect.provideService(Tone, tone));
        // A node that cannot take its params is not kept half set up.
        yield* applyParams(node, block).pipe(
          Effect.tapError(() => Effect.sync(() => release(node))),
        );
        return node;
      });

    // Renders a block and, for a tree, everything under it. A leaf or patch
    // that fails is stored as failed, and rendering carries on past it.
    const renderBlock = (blockId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const block = getState().blocks[blockId];
        if (block === undefined) return;

        if (block.type === "leaf") {
          const exit = yield* Effect.exit(buildLeaf(block));
          yield* putBlock(blockId, {
            kind: "leaf",
            blockId,
            parentId: block.parentId,
            exit,
          });
          for (const eventId of block.eventIds) yield* renderEvent(eventId);
          return;
        }

        yield* putBlock(blockId, {
          kind: "tree",
          blockId,
          parentId: block.parentId,
        });
        for (const childId of block.children) yield* renderBlock(childId);
        for (const patchId of block.patches)
          yield* renderPatch(patchId, blockId);
      });

    const removeBlock = (blockId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const rendered = yield* Ref.get(ref);
        const block = rendered.blocks.get(blockId);
        if (block === undefined) return;

        if (block.kind === "tree") {
          for (const patch of rendered.patches.values()) {
            if (patch.treeId === blockId) yield* removePatch(patch.patchId);
          }
          for (const child of rendered.blocks.values()) {
            if (child.parentId === blockId) yield* removeBlock(child.blockId);
          }
        } else {
          for (const event of rendered.events.values()) {
            if (event.blockId === blockId) yield* removeEvent(event.eventId);
          }
          if (Exit.isSuccess(block.exit)) release(block.exit.value);
        }

        yield* putBlock(blockId, undefined);
      });

    // --- Patches ----------------------------------------------------------

    const patchEnd = (blockId: string) =>
      leafNode(blockId).pipe(
        Effect.mapError((error) => new PatchError({ message: error.message })),
      );

    const connect = (patchId: string) =>
      Effect.gen(function* () {
        const state = getState();
        const patch = state.patches[patchId];
        const fromBlockId = patch && state.jacks[patch.from]?.belongToBlockId;
        const toBlockId = patch && state.jacks[patch.to]?.belongToBlockId;
        if (fromBlockId === undefined || toBlockId === undefined) {
          return yield* new PatchError({
            message: `Patch ${patchId} is missing a jack`,
          });
        }

        const from = yield* patchEnd(fromBlockId);
        const to = yield* patchEnd(toBlockId);
        yield* Effect.try({
          try: () => from.connect(to),
          catch: (cause) =>
            new PatchError({ message: `Could not connect: ${String(cause)}` }),
        });

        return { fromBlockId, toBlockId };
      });

    const renderPatch = (patchId: string, treeId: string) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(connect(patchId));
        yield* putPatch(patchId, { patchId, treeId, exit });
        return exit;
      });

    const nodeOrNothing = (blockId: string) =>
      leafNode(blockId).pipe(Effect.orElseSucceed(() => undefined));

    const removePatch = (patchId: string) =>
      Effect.gen(function* () {
        const rendered = yield* Ref.get(ref);
        const patch = rendered.patches.get(patchId);
        if (patch === undefined) return;

        if (Exit.isSuccess(patch.exit)) {
          const { fromBlockId, toBlockId } = patch.exit.value;
          // Either end may already be gone, and with it the connection.
          yield* Effect.gen(function* () {
            const from = yield* leafNode(fromBlockId);
            const to = yield* leafNode(toBlockId);
            // Web Audio keeps one connection per pair of nodes, however many
            // patches made it. Two patches can join the same nodes, e.g. a
            // synth into two Destination blocks, which share Tone's output.
            for (const other of rendered.patches.values()) {
              if (other.patchId === patchId || !Exit.isSuccess(other.exit)) {
                continue;
              }
              const ends = other.exit.value;
              const otherFrom = yield* nodeOrNothing(ends.fromBlockId);
              const otherTo = yield* nodeOrNothing(ends.toBlockId);
              if (otherFrom === from && otherTo === to) return;
            }
            yield* Effect.try(() => from.disconnect(to));
          }).pipe(Effect.ignore);
        }

        yield* putPatch(patchId, undefined);
      });

    // --- Methods ----------------------------------------------------------

    // Calls a method on a node. `time`, when given, goes in the method's time
    // arg, as when a scheduled event fires.
    const invoke = (
      node: ToneNode,
      method: Method,
      args: Readonly<Record<string, ParamValue>>,
      time?: number,
    ) =>
      Effect.gen(function* () {
        const call = (node as unknown as Record<string, unknown>)[
          method.method
        ];
        if (typeof call !== "function") {
          return yield* new LeafError({
            message: `Node has no method ${method.method}`,
          });
        }

        const at = time === undefined ? undefined : timeArg(method);
        const given = at === undefined ? args : { ...args, [at.name]: time };
        // Arguments go in the order the method declares them; one left
        // out falls back to its default, or to Tone's own.
        const values = method.args.map(
          (arg) => given[arg.name] ?? arg.defaultValue,
        );
        yield* Effect.try({
          try: () => call.apply(node, values),
          catch: (cause) =>
            new LeafError({
              message: `${method.name} failed: ${String(cause)}`,
            }),
        });
      });

    // --- Events -----------------------------------------------------------

    // Tone's event classes all fire `(time, value)` and share the ToneEvent
    // knobs, so only their construction differs.
    const buildEvent = (event: RackEvent) =>
      Effect.gen(function* () {
        const node = yield* leafNode(event.belongToBlockId);
        const method = getState().methods[event.methodId];
        if (method === undefined) {
          return yield* new LeafError({
            message: `No method ${event.methodId}`,
          });
        }
        const note = noteArg(method);

        // A throw here would surface inside Tone's clock, out of reach, so a
        // rest is skipped before the call and a failed call is only logged.
        // A ToneEvent with no value fires with null, which is not a rest: a
        // loop calls with its fixed args.
        const callback = (time: number, value?: string | number | null) => {
          if (value === null && event.kind !== "event") return;
          const args =
            note === undefined || value === undefined || value === null
              ? event.args
              : { ...event.args, [note.name]: value };
          Effect.runSync(
            invoke(node, method, args, time).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => console.warn(error)),
              ),
              Effect.ignore,
            ),
          );
        };

        return yield* Effect.try({
          try: (): ToneScheduled => {
            const scheduled = construct(event, callback);
            if (event.probability !== undefined) {
              scheduled.probability = event.probability;
            }
            if (event.humanize !== undefined)
              scheduled.humanize = event.humanize;
            if (event.playbackRate !== undefined) {
              scheduled.playbackRate = event.playbackRate;
            }
            scheduled.mute = event.mute;
            // A ToneEvent starts where it says; the rest start with the
            // transport and loop or play from there.
            scheduled.start(event.kind === "event" ? event.start : 0);
            return scheduled;
          },
          catch: (cause) =>
            new LeafError({
              message: `Could not schedule ${method.name}: ${String(cause)}`,
            }),
        });
      });

    const construct = (
      event: RackEvent,
      callback: (time: number, value?: string | number | null) => void,
    ): ToneScheduled => {
      switch (event.kind) {
        case "sequence":
          return new tone.Sequence(
            callback,
            [...event.steps],
            event.subdivision,
          );
        case "event": {
          const scheduled = new tone.ToneEvent(callback, event.value);
          scheduled.loop = event.loop;
          if (event.loopEnd !== undefined) scheduled.loopEnd = event.loopEnd;
          return scheduled;
        }
        case "pattern":
          return new tone.Pattern({
            callback,
            values: [...event.values],
            pattern: event.pattern,
            interval: event.interval,
          });
        case "part": {
          const scheduled = new tone.Part(
            callback,
            event.steps.map((step) => [step.time, step.value]),
          );
          if (event.loopEnd !== undefined) {
            scheduled.loop = true;
            scheduled.loopEnd = event.loopEnd;
          }
          return scheduled;
        }
      }
    };

    const renderEvent = (eventId: string) =>
      Effect.gen(function* () {
        const event = getState().events[eventId];
        if (event === undefined) {
          return Exit.fail(new LeafError({ message: `No event ${eventId}` }));
        }
        const exit = yield* Effect.exit(buildEvent(event));
        yield* putEvent(eventId, {
          eventId,
          blockId: event.belongToBlockId,
          exit,
        });
        return exit;
      });

    const disposeEvent = (event: RenderedEvent) => {
      if (!Exit.isSuccess(event.exit)) return;
      event.exit.value.stop();
      event.exit.value.dispose();
    };

    const removeEvent = (eventId: string) =>
      Effect.gen(function* () {
        const event = (yield* Ref.get(ref)).events.get(eventId);
        if (event === undefined) return;
        disposeEvent(event);
        yield* putEvent(eventId, undefined);
      });

    // --- Commands ---------------------------------------------------------

    const transport = tone.getTransport();

    const updateEvent = (eventId: string) =>
      Effect.gen(function* () {
        yield* removeEvent(eventId);
        const exit = yield* renderEvent(eventId);
        yield* exit;
      });

    return {
      rendered: Ref.get(ref),

      render: Effect.gen(function* () {
        const old = yield* Ref.get(ref);
        for (const event of old.events.values()) disposeEvent(event);
        for (const block of old.blocks.values()) {
          if (block.kind === "leaf" && Exit.isSuccess(block.exit)) {
            release(block.exit.value);
          }
        }
        yield* Ref.set(ref, empty);
        // Paused rather than stopped, so a re-run carries on from where the
        // playhead is instead of going back to the start.
        transport.pause();
        transport.cancel(0);
        transport.bpm.value = getState().transport.bpm;
        transport.loop = false;
        yield* renderBlock(getState().rootId);
        transport.start();
      }),

      addBlock: (blockId) =>
        Effect.gen(function* () {
          yield* removeBlock(blockId);
          yield* renderBlock(blockId);

          const block = (yield* Ref.get(ref)).blocks.get(blockId);
          if (block === undefined) {
            return yield* new LeafError({ message: `No block ${blockId}` });
          }
          if (block.kind === "leaf") yield* block.exit;
        }),

      deleteBlock: (blockId) => removeBlock(blockId),

      addPatch: (patchId) =>
        Effect.gen(function* () {
          const tree = Object.values(getState().blocks).find(
            (block) => block.type === "tree" && block.patches.includes(patchId),
          );
          if (tree === undefined) {
            return yield* new PatchError({
              message: `Patch ${patchId} is not in any rack`,
            });
          }

          yield* removePatch(patchId);
          const exit = yield* renderPatch(patchId, tree.id);
          yield* exit;
        }),

      deletePatch: (patchId) => removePatch(patchId),

      updateParam: (paramId) =>
        Effect.gen(function* () {
          const param = getState().params[paramId];
          if (param === undefined) {
            return yield* new LeafError({ message: `No param ${paramId}` });
          }
          const node = yield* leafNode(param.belongToBlockId);
          const block = getState().blocks[param.belongToBlockId];
          const target = yield* locate(node, param).pipe(
            Effect.map(({ owner, key }) => owner[key]),
            Effect.orElseSucceed(() => undefined),
          );
          // An audio param changes only itself. Setting a plain property, like
          // oscillator type, can rebuild part of the node and reset the params
          // under it, so the whole block is applied again.
          if (isAudioParam(target) || block?.type !== "leaf") {
            yield* applyParam(node, param);
          } else {
            yield* applyParams(node, block);
          }
        }),

      runLeafMethod: (methodId, args) =>
        Effect.gen(function* () {
          const method = getState().methods[methodId];
          if (method === undefined) {
            return yield* new LeafError({ message: `No method ${methodId}` });
          }

          const node = yield* leafNode(method.belongToBlockId);
          yield* invoke(node, method, args);
        }),

      updateEvent,

      updateEventLive: (eventId) =>
        Effect.gen(function* () {
          const event = getState().events[eventId];
          const rendered = (yield* Ref.get(ref)).events.get(eventId);
          if (
            event?.kind !== "sequence" ||
            rendered === undefined ||
            !Exit.isSuccess(rendered.exit) ||
            !(rendered.exit.value instanceof tone.Sequence)
          ) {
            return yield* updateEvent(eventId);
          }
          // Tone reschedules a sequence when its events are assigned.
          rendered.exit.value.events = [...event.steps];
        }),

      deleteEvent: removeEvent,

      updateTransport: Effect.sync(() => {
        transport.bpm.value = getState().transport.bpm;
      }),

      stop: Effect.gen(function* () {
        const rendered = yield* Ref.get(ref);
        for (const event of rendered.events.values()) {
          yield* removeEvent(event.eventId);
        }
        transport.stop();
        transport.cancel(0);
        // An attack with no release yet, or whose release Stop just cancelled,
        // would sustain for good, so every instrument is told to let go.
        for (const block of rendered.blocks.values()) {
          if (block.kind !== "leaf" || !Exit.isSuccess(block.exit)) continue;
          const node = block.exit.value as unknown as Record<string, unknown>;
          const release = node["releaseAll"] ?? node["triggerRelease"];
          if (typeof release === "function") release.call(node);
        }
      }),
    };
  });
