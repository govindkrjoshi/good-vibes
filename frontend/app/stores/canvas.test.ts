import { beforeEach, expect, test } from "vitest";
import { useCanvasStore } from "./canvas";

// The store is a module singleton, so it carries state between tests. Snapshot
// it before anything runs and replace it wholesale each time. The snapshot
// holds the actions too, so replacing keeps them.
const initial = useCanvasStore.getState();

const locked = () => useCanvasStore.getState().locked;

beforeEach(() => {
  useCanvasStore.setState(initial, true);
});

test("starts unlocked", () => {
  expect(locked()).toBe(false);
});

test("flips the lock on each toggle", () => {
  useCanvasStore.getState().toggleLock();
  expect(locked()).toBe(true);

  useCanvasStore.getState().toggleLock();
  expect(locked()).toBe(false);
});

test("resets between tests", () => {
  expect(locked()).toBe(false);
});
