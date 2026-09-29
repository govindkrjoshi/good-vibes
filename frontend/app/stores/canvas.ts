import type { XYPosition } from "@xyflow/react";
import { create } from "zustand";
import type { BlockDimensions } from "~/lib/flow";

/**
 * How far each successive block shifts when several are dropped on the same
 * spot. The step clears a block's height, so a run of them ladders down the
 * canvas instead of burying each other's titles.
 */
const cascadeStep = { x: 32, y: 56 };
const cascadeLength = 6;

export type CanvasState = {
  /** Locked canvas: blocks stay put and nothing can be selected or wired. */
  readonly locked: boolean;
  /** Where each block sits, keyed by block id. This is how the canvas lays the
   * rack out; the rack itself has no geometry. */
  readonly positions: Record<string, XYPosition>;
  /** What React Flow measured each block at. Controlled nodes lose their
   * measurement every time the node list is rebuilt, so it is kept here and
   * folded back in, or React Flow counts them uninitialised and will not drag
   * them. */
  readonly dimensions: Record<string, BlockDimensions>;
  /** Ids of the selected blocks. React Flow's nodes are controlled, so their
   * selection lives here rather than inside React Flow. */
  readonly selectedIds: readonly string[];
};

export type CanvasStore = CanvasState & {
  readonly toggleLock: () => void;
  /** Gives a block its first spot on the canvas, cascaded off `at` so a run of
   * new blocks does not pile up on one point. */
  readonly placeBlock: (id: string, at: XYPosition) => void;
  /** Moves a block to exactly `position`, as dragging does. */
  readonly moveBlock: (id: string, position: XYPosition) => void;
  /** Records what React Flow measured a block at. */
  readonly resizeBlock: (id: string, dimensions: BlockDimensions) => void;
  readonly selectBlock: (id: string, selected: boolean) => void;
};

export const initialCanvasState: CanvasState = {
  locked: false,
  positions: {},
  dimensions: {},
  selectedIds: [],
};

export const useCanvasStore = create<CanvasStore>()((set) => ({
  ...initialCanvasState,
  toggleLock: () => set((state) => ({ locked: !state.locked })),

  placeBlock: (id, at) =>
    set((state) => {
      const step = Object.keys(state.positions).length % cascadeLength;

      return {
        positions: {
          ...state.positions,
          [id]: {
            x: at.x + step * cascadeStep.x,
            y: at.y + step * cascadeStep.y,
          },
        },
      };
    }),

  moveBlock: (id, position) =>
    set((state) => ({ positions: { ...state.positions, [id]: position } })),

  resizeBlock: (id, dimensions) =>
    set((state) => {
      // React Flow measures on every rebuild of the node list, and most of
      // those measurements say what the last one said. Writing them anyway
      // would hand back a new `dimensions` object, rebuild every node, and
      // set the next measurement going.
      const held = state.dimensions[id];
      if (
        held?.width === dimensions.width &&
        held.height === dimensions.height
      ) {
        return state;
      }

      return { dimensions: { ...state.dimensions, [id]: dimensions } };
    }),

  selectBlock: (id, selected) =>
    set((state) => {
      const held = state.selectedIds.includes(id);
      if (held === selected) return state;

      return {
        selectedIds: selected
          ? [...state.selectedIds, id]
          : state.selectedIds.filter((other) => other !== id),
      };
    }),
}));
