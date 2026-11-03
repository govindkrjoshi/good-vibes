import type { ReadoutValue } from "../rack/renderer";

// Readouts arrive many times a second, so they skip the store: a rack's panel
// subscribes and draws each one as it comes.
type Listener = (value: ReadoutValue) => void;

const listeners = new Map<string, Set<Listener>>();

export const publishReadouts = (
  values: Readonly<Record<string, ReadoutValue>>,
) => {
  for (const [rackId, value] of Object.entries(values)) {
    for (const listener of listeners.get(rackId) ?? []) listener(value);
  }
};

export const subscribeReadout = (rackId: string, listener: Listener) => {
  const held = listeners.get(rackId) ?? new Set();
  held.add(listener);
  listeners.set(rackId, held);
  return () => {
    held.delete(listener);
    if (held.size === 0) listeners.delete(rackId);
  };
};
