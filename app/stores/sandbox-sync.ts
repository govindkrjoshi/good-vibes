import type { StateCreator, StoreApi, StoreMutatorIdentifier } from "zustand";

import { diffRack } from "../rack/diff";
import type { RackState } from "../rack/model";
import { sendToSandbox } from "../sandbox/channel";

// Sends the sandbox what changed in the rack, after every change to the store.
export const sandboxSync =
  <
    T extends { readonly rack: RackState },
    Mps extends [StoreMutatorIdentifier, unknown][] = [],
    Mcs extends [StoreMutatorIdentifier, unknown][] = [],
  >(
    creator: StateCreator<T, Mps, Mcs>,
  ): StateCreator<T, Mps, Mcs> =>
  (set, get, api) => {
    (api as unknown as StoreApi<T>).subscribe((next, prev) => {
      const ops = diffRack(prev.rack, next.rack);
      if (ops.length > 0) sendToSandbox({ type: "diff", ops });
    });
    return creator(set, get, api);
  };
