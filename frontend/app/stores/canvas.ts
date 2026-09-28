import { create } from "zustand";

export type CanvasState = {
  /** Locked canvas: blocks stay put and nothing can be selected or wired. */
  readonly locked: boolean;
};

export type CanvasStore = CanvasState & {
  readonly toggleLock: () => void;
};

export const initialCanvasState: CanvasState = { locked: false };

export const useCanvasStore = create<CanvasStore>()((set) => ({
  ...initialCanvasState,
  toggleLock: () => set((state) => ({ locked: !state.locked })),
}));
