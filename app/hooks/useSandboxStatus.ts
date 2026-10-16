import { useStore } from "zustand";
import { sandboxStatus, type SandboxStatus } from "../sandbox";

// Reads a slice of what the app knows about the sandbox frame, re-rendering
// when the slice changes.
export const useSandboxStatus = <T>(
  selector: (status: SandboxStatus) => T,
): T => useStore(sandboxStatus, selector);
