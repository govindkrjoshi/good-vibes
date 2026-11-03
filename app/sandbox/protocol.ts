import type { RackOp } from "../rack/diff";
import type { ReadoutValue } from "../rack/renderer";

// `sync` starts over from nothing; `diff` carries on from the last message.
export type HostMessage =
  | { readonly type: "ping" }
  | { readonly type: "sync"; readonly ops: readonly RackOp[] }
  | { readonly type: "diff"; readonly ops: readonly RackOp[] };

export type FrameMessage =
  | { readonly type: "ready" }
  | { readonly type: "error"; readonly message: string }
  // What every readout rack shows, by rack id, many times a second.
  | {
      readonly type: "readout";
      readonly values: Readonly<Record<string, ReadoutValue>>;
    };
