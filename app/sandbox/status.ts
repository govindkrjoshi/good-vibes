import { createStore } from "zustand";
import type { Connection, ErrorEntry } from "./ledger";
import type { AudioState } from "./protocol";

// What the app knows about the sandbox frame, for the UI and the agent to
// read: whether it is connected, how audio is doing, and what failed. The
// sandbox client is its only writer. It is kept apart from the rack store
// because the rack module does not know about the sandbox.
export type SandboxStatus = {
  readonly connection: Connection;
  readonly audio?: AudioState;
  // By `${kind}:${id}`, as the ledger keeps them.
  readonly errors: Readonly<Record<string, ErrorEntry>>;
  // Work answered so far, and work accepted so far, as workSeq.
  readonly settledSeq: number;
  readonly latestSeq: number;
  // Set when a batch could not be posted, until the rack changes again.
  readonly syncBlocked?: string;
  // Commands sent and not yet answered.
  readonly pending: number;
};

export const initialSandboxStatus: SandboxStatus = {
  connection: { _tag: "Disconnected" },
  errors: {},
  settledSeq: 0,
  latestSeq: 0,
  pending: 0,
};

export const sandboxStatus = createStore<SandboxStatus>()(
  () => initialSandboxStatus,
);
