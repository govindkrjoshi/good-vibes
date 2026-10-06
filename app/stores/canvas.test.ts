import { beforeEach, expect, test } from "vitest";
import { useCanvasStore } from "./canvas";

const initial = useCanvasStore.getState();

const state = () => useCanvasStore.getState();
const locked = () => state().locked;

beforeEach(() => {
  useCanvasStore.setState(initial, true);
});

test("starts unlocked", () => {
  expect(locked()).toBe(false);
});

test("flips the lock on each toggle", () => {
  state().toggleLock();
  expect(locked()).toBe(true);

  state().toggleLock();
  expect(locked()).toBe(false);
});

test("resets between tests", () => {
  expect(locked()).toBe(false);
});
