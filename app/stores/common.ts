import type { StateCreator } from "zustand";

import type { CatalogueSlice } from "./catalogue";
import type { ChatSlice } from "./chat";
import type { RackSlice } from "./rack";

export type Store = {
  readonly rack: RackSlice;
  readonly catalogue: CatalogueSlice;
  readonly chat: ChatSlice;
};

export type Middlewares = [
  ["zustand/devtools", never],
  ["zustand/persist", unknown],
  ["zustand/immer", never],
];

export type SliceCreator<Slice> = StateCreator<Store, Middlewares, [], Slice>;
