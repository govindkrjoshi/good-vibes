import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { Store } from "./common";
import { createRackSlice } from "./rack";
import { createCatalogueSlice } from "./catalogue";

export type { Store } from "./common";

export const useStore = create<Store>()(
  devtools(
    immer((...args) => ({
      rack: createRackSlice(...args),
      catalogue: createCatalogueSlice(...args),
    })),
    { name: "good-vibes" },
  ),
);
