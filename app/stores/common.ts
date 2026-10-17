import type { StateCreator } from "zustand";

import type { CatalogueSlice } from "./catalogue";
import type { RackSlice } from "./rack";

export type Store = {
  readonly rack: RackSlice;
  readonly catalogue: CatalogueSlice;
};

export type Middlewares = [
  ["zustand/devtools", never],
  ["zustand/immer", never],
];

export type SliceCreator<Slice> = StateCreator<Store, Middlewares, [], Slice>;
