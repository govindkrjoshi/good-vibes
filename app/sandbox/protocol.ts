import type { RackOp } from "../rack/diff";

// `sync` starts over from nothing; `diff` carries on from the last message.
export type HostMessage =
  | { readonly type: "ping" }
  | { readonly type: "sync"; readonly ops: readonly RackOp[] }
  | { readonly type: "diff"; readonly ops: readonly RackOp[] };

export type FrameMessage =
  | { readonly type: "ready" }
  | { readonly type: "error"; readonly message: string };
