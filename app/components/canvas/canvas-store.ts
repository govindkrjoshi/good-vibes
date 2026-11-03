import { create } from "zustand";

type CanvasState = {
  readonly locked: boolean;
  // The tree a dragged rack would land in if it were dropped now.
  readonly dropTargetId: string | undefined;
};

type CanvasStore = CanvasState & {
  readonly toggleLock: () => void;
  readonly setDropTarget: (id: string | undefined) => void;
};

export const initialCanvasState: CanvasState = {
  locked: false,
  dropTargetId: undefined,
};

export const useCanvasStore = create<CanvasStore>()((set) => ({
  ...initialCanvasState,
  toggleLock: () => set((state) => ({ locked: !state.locked })),
  setDropTarget: (dropTargetId) => set({ dropTargetId }),
}));
