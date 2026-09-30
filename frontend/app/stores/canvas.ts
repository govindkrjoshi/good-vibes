import { create } from "zustand";

/**
 * Canvas-wide UI state. Where blocks sit, how big they measured and which are
 * selected is React Flow's to hold, so none of it lives here.
 */
export type CanvasState = {
  /** Locked canvas: blocks stay put and nothing can be selected or wired. */
  readonly locked: boolean;
};

export type CanvasStore = CanvasState & {
  readonly toggleLock: () => void;
};

export const initialCanvasState: CanvasState = {
  locked: false,
};

export const useCanvasStore = create<CanvasStore>()((set) => ({
  ...initialCanvasState,
  toggleLock: () => set((state) => ({ locked: !state.locked })),
}));
