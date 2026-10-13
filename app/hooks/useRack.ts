import { useStore } from "zustand";
import { rackStore, type RackStore } from "../rack";

// Reads a slice of the rack store, re-rendering when the slice changes.
export const useRack = <T>(selector: (state: RackStore) => T): T =>
  useStore(rackStore, selector);
