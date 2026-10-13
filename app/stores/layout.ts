import { create } from "zustand";

export type LayoutState = {
  readonly chatOpen: boolean;
};

export type LayoutStore = LayoutState & {
  readonly toggleChat: () => void;
  readonly setChatOpen: (open: boolean) => void;
};

export const initialLayoutState: LayoutState = {
  chatOpen: true,
};

export const useLayoutStore = create<LayoutStore>()((set) => ({
  ...initialLayoutState,
  toggleChat: () => set((state) => ({ chatOpen: !state.chatOpen })),
  setChatOpen: (open) => set({ chatOpen: open }),
}));
