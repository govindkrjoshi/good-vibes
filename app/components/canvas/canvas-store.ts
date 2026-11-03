import { create } from "zustand";

type CanvasState = {
  readonly locked: boolean;
  // The tree a dragged rack would land in if it were dropped now.
  readonly dropTargetId: string | undefined;
  // Counts the requests to lay the racks out again, so one can be told from
  // the next; the canvas answers it once the racks are drawn.
  readonly arrangeRequest: number;
};

type CanvasStore = CanvasState & {
  readonly toggleLock: () => void;
  readonly setDropTarget: (id: string | undefined) => void;
  readonly requestArrange: () => void;
};

export const initialCanvasState: CanvasState = {
  locked: false,
  dropTargetId: undefined,
  arrangeRequest: 0,
};

export const useCanvasStore = create<CanvasStore>()((set) => ({
  ...initialCanvasState,
  toggleLock: () => set((state) => ({ locked: !state.locked })),
  setDropTarget: (dropTargetId) => set({ dropTargetId }),
  requestArrange: () =>
    set((state) => ({ arrangeRequest: state.arrangeRequest + 1 })),
}));
