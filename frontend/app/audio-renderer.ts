import { Context, Data, Effect, Exit, Ref } from "effect";
import type * as ToneJs from "tone";
import type { RackState } from "./stores/rack";
import type {
  AutomationEvent,
  LeafRack,
  Param,
  ParamValue,
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

export type RenderedRackState = {
  readonly blocks: ReadonlyMap<string, RenderedBlock>;
  readonly patches: ReadonlyMap<string, RenderedPatch>;
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
};

const empty: RenderedRackState = { blocks: new Map(), patches: new Map() };

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
    const setBlock = (block: RenderedBlock) =>
      Ref.update(ref, (state) => ({
        ...state,
        blocks: new Map(state.blocks).set(block.blockId, block),
      }));

    const forgetBlock = (blockId: string) =>
      Ref.update(ref, (state) => {
        const blocks = new Map(state.blocks);
        blocks.delete(blockId);
        return { ...state, blocks };
      });

    const setPatch = (patch: RenderedPatch) =>
      Ref.update(ref, (state) => ({
        ...state,
        patches: new Map(state.patches).set(patch.patchId, patch),
      }));

    const forgetPatch = (patchId: string) =>
      Ref.update(ref, (state) => {
        const patches = new Map(state.patches);
        patches.delete(patchId);
        return { ...state, patches };
      });

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
    const locate = (node: ToneNode, param: Param) => {
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

    const schedule = (
      target: ToneJs.Param | ToneJs.Signal,
      event: AutomationEvent,
    ) => {
      switch (event.method) {
        case "setValueAtTime":
          return target.setValueAtTime(event.value, event.time);
        case "rampTo":
          // The editor always fills in a ramp time; "0.1" matches its default.
          return target.rampTo(
            event.value,
            event.rampTime ?? "0.1",
            event.time,
          );
        case "linearRampToValueAtTime":
          return target.linearRampToValueAtTime(event.value, event.time);
        case "exponentialRampToValueAtTime":
          return target.exponentialRampToValueAtTime(event.value, event.time);
      }
    };

    // Sets a param on the node to what the store holds. An audio param's value
    // and automation are both events on the same timeline, and clearing one
    // clears the other, so they are always applied together: clear, set the
    // value, then schedule the automation. Tone works out when each event
    // lands from its time.
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
              target.cancelScheduledValues(0);
              target.value = value as number;
              for (const event of events) schedule(target, event);
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

    const applyParams = (node: ToneNode, blockId: string) =>
      Effect.forEach(
        Object.values(getState().params).filter(
          (param) => param.belongToBlockId === blockId,
        ),
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
        yield* applyParams(node, block.id).pipe(
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
          yield* setBlock({
            kind: "leaf",
            blockId,
            parentId: block.parentId,
            exit,
          });
          return;
        }

        yield* setBlock({ kind: "tree", blockId, parentId: block.parentId });
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
        } else if (Exit.isSuccess(block.exit)) {
          release(block.exit.value);
        }

        yield* forgetBlock(blockId);
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
          try: () => {
            if (to === tone.getDestination()) from.toDestination();
            else from.connect(to);
          },
          catch: (cause) =>
            new PatchError({ message: `Could not connect: ${String(cause)}` }),
        });

        return { fromBlockId, toBlockId };
      });

    const renderPatch = (patchId: string, treeId: string) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(connect(patchId));
        yield* setPatch({ patchId, treeId, exit });
        return exit;
      });

    const removePatch = (patchId: string) =>
      Effect.gen(function* () {
        const patch = (yield* Ref.get(ref)).patches.get(patchId);
        if (patch === undefined) return;

        if (Exit.isSuccess(patch.exit)) {
          const { fromBlockId, toBlockId } = patch.exit.value;
          // Either end may already be gone, and with it the connection.
          yield* Effect.gen(function* () {
            const from = yield* leafNode(fromBlockId);
            const to = yield* leafNode(toBlockId);
            yield* Effect.try(() => from.disconnect(to));
          }).pipe(Effect.ignore);
        }

        yield* forgetPatch(patchId);
      });

    // --- Commands ---------------------------------------------------------

    return {
      rendered: Ref.get(ref),

      render: Effect.gen(function* () {
        for (const block of (yield* Ref.get(ref)).blocks.values()) {
          if (block.kind === "leaf" && Exit.isSuccess(block.exit)) {
            release(block.exit.value);
          }
        }
        yield* Ref.set(ref, empty);
        yield* renderBlock(getState().rootId);
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
          yield* applyParam(node, param);
        }),

      runLeafMethod: (methodId, args) =>
        Effect.gen(function* () {
          const method = getState().methods[methodId];
          if (method === undefined) {
            return yield* new LeafError({ message: `No method ${methodId}` });
          }

          const node = yield* leafNode(method.belongToBlockId);
          const call = (node as unknown as Record<string, unknown>)[
            method.method
          ];
          if (typeof call !== "function") {
            return yield* new LeafError({
              message: `Node has no method ${method.method}`,
            });
          }

          // Arguments go in the order the method declares them; one left
          // out falls back to its default, or to Tone's own.
          const values = method.args.map(
            (arg) => args[arg.name] ?? arg.defaultValue,
          );
          yield* Effect.try({
            try: () => call.apply(node, values),
            catch: (cause) =>
              new LeafError({
                message: `${method.name} failed: ${String(cause)}`,
              }),
          });
        }),
    };
  });
