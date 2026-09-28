import { create } from "zustand";
import {
  makeBlock,
  toTree,
  type Jack,
  type Patch,
  type Rack,
  emptyRack,
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
  readonly run: () => void;
};

export const initialRackState: RackState = {
  blocks: { [emptyRack.id]: emptyRack },
  jacks: {},
  patches: {},
  rootId: emptyRack.id,
};

export const useRackStore = create<RackStore>()((set, get) => ({
  ...initialRackState,

  addBlock: (blockType) => {
    const { blocks, rootId } = get();
    const current = blocks[rootId];

    // A leaf root has nowhere to hang children. Reparenting it is a rack
    // operation of its own, so leave the rack alone until that exists.
    if (current.type === "node") return undefined;

    // An empty rack is a rack with no blocks, so the first block added turns
    // the root into the tree that holds it.
    const root = current.type === "tree" ? current : toTree(current, [], []);
    const block = makeBlock(crypto.randomUUID(), root.id, blockType);

    set((state) => ({
      blocks: {
        ...state.blocks,
        [root.id]: { ...root, children: [...root.children, block.id] },
        [block.id]: block,
      },
    }));

    return block.id;
  },

  run: () => {
    // Running a rack is not built yet: the Run button, the menu item and the
    // R shortcut all land here so the wiring is in place, and this fills in
    // as the interpreter arrives.
  },
}));
