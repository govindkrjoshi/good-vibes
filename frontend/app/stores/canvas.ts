import { create } from "zustand";

export type CanvasState = {
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
