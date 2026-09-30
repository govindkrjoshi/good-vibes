import { create } from "zustand";
import {
  canPatch,
  makeBlock,
  makeDefaultJacks,
  rootRack,
  type Jack,
  type Patch,
  type Rack,
  type TreeBlock,
} from "~/types/rack";

export type RackState = {
  /** Every block in the rack, flat and keyed by id. */
  readonly blocks: Record<string, Rack>;
  readonly jacks: Record<string, Jack>;
  readonly patches: Record<string, Patch>;
  readonly rootId: string;
};

export type RackStore = RackState & {
  /** Adds a block under the root and returns its id, or `undefined` when the
   * rack has nowhere to put it. The canvas needs the id to place the block. */
  readonly addBlock: (blockType: "node" | "tree") => string | undefined;
  /** Patches an output jack to an input jack on another block under the root
   * and returns the patch id, or `undefined` when the two cannot be patched.
   * Patching a pair that is already patched hands back the patch already
   * joining them, so a second drag across the same two jacks does not stack a
   * duplicate edge on top of the first. */
  readonly connectJacks: (
    fromJackId: string,
    toJackId: string,
  ) => string | undefined;
  /** Whether `connectJacks` would patch these two jacks. The canvas asks
   * before it lets a drag land, so an impossible connection is refused on the
   * spot rather than silently dropped once the user lets go. */
  readonly canConnectJacks: (fromJackId: string, toJackId: string) => boolean;
  /** Removes these blocks from under the root, along with their jacks and
   * every patch wired to them. Ids that are not children of the root, the
   * root included, are ignored. */
  readonly removeBlocks: (blockIds: readonly string[]) => void;
  readonly run: () => void;
};

/** The root and both jacks, when a patch between them is possible at all. */
const resolvePatch = (
  state: RackState,
  fromJackId: string,
  toJackId: string,
):
  | { readonly root: TreeBlock; readonly from: Jack; readonly to: Jack }
  | undefined => {
  const root = state.blocks[state.rootId];
  const from = state.jacks[fromJackId];
  const to = state.jacks[toJackId];

  if (
    root === undefined ||
    root.type !== "tree" ||
    from === undefined ||
    to === undefined ||
    !canPatch(root, from, to)
  ) {
    return undefined;
  }

  return { root, from, to };
};

export const initialRackState: RackState = {
  blocks: { [rootRack.id]: rootRack },
  jacks: {},
  patches: {},
  rootId: rootRack.id,
};

export const useRackStore = create<RackStore>()((set, get) => ({
  ...initialRackState,

  addBlock: (blockType) => {
    const { blocks, rootId } = get();
    const root = blocks[rootId];

    if (root === undefined || root.type !== "tree") return undefined;

    const block = makeBlock(crypto.randomUUID(), root.id, blockType);
    const jacks = makeDefaultJacks(block.id);

    set((state) => ({
      blocks: {
        ...state.blocks,
        [root.id]: { ...root, children: [...root.children, block.id] },
        [block.id]: block,
      },
      jacks: {
        ...state.jacks,
        ...Object.fromEntries(jacks.map((jack) => [jack.id, jack])),
      },
    }));

    return block.id;
  },

  canConnectJacks: (fromJackId, toJackId) =>
    resolvePatch(get(), fromJackId, toJackId) !== undefined,

  connectJacks: (fromJackId, toJackId) => {
    const state = get();
    const resolved = resolvePatch(state, fromJackId, toJackId);
    if (resolved === undefined) return undefined;

    const { root, from, to } = resolved;

    // React Flow reports a connection for every drag that lands, so the same
    // pair of jacks can arrive more than once. Two patches between one pair
    // would draw as two edges stacked on the same line, with no way to tell
    // them apart or to remove only one.
    const held = root.patches.find((id) => {
      const patch = state.patches[id];
      return patch?.from === from.id && patch.to === to.id;
    });
    if (held !== undefined) return held;

    const patch: Patch = {
      id: crypto.randomUUID(),
      name: `${from.name} → ${to.name}`,
      from: from.id,
      to: to.id,
    };

    set((state) => ({
      blocks: {
        ...state.blocks,
        [root.id]: { ...root, patches: [...root.patches, patch.id] },
      },
      patches: { ...state.patches, [patch.id]: patch },
    }));

    return patch.id;
  },

  removeBlocks: (blockIds) => {
    const state = get();
    const root = state.blocks[state.rootId];
    if (root === undefined || root.type !== "tree") return;

    const doomed = new Set(blockIds.filter((id) => root.children.includes(id)));
    if (doomed.size === 0) return;

    // A patch left behind would point at a jack that no longer exists.
    const cut = new Set(
      root.patches.filter((id) => {
        const patch = state.patches[id];
        return (
          patch !== undefined &&
          [patch.from, patch.to].some((jackId) => {
            const owner = state.jacks[jackId]?.belongToBlockId;
            return owner !== undefined && doomed.has(owner);
          })
        );
      }),
    );

    const without = <T>(
      record: Record<string, T>,
      drop: (id: string, value: T) => boolean,
    ) =>
      Object.fromEntries(
        Object.entries(record).filter(([id, value]) => !drop(id, value)),
      );

    set({
      blocks: {
        ...without(state.blocks, (id) => doomed.has(id)),
        [root.id]: {
          ...root,
          children: root.children.filter((id) => !doomed.has(id)),
          patches: root.patches.filter((id) => !cut.has(id)),
        },
      },
      jacks: without(state.jacks, (_, jack) =>
        doomed.has(jack.belongToBlockId),
      ),
      patches: without(state.patches, (id) => cut.has(id)),
    });
  },

  run: () => {
    // Running a rack is not built yet: the Run button, the menu item and the
    // R shortcut all land here so the wiring is in place, and this fills in
    // as the interpreter arrives.
  },
}));
