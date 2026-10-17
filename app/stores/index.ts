import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { Store } from "./common";
import { createRackSlice } from "./rack";

export type { Store } from "./common";

export const useStore = create<Store>()(
  devtools(
    immer((...args) => ({
      rack: createRackSlice(...args),
    })),
    { name: "good-vibes" },
  ),
);
