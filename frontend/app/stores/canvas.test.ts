import { beforeEach, expect, test } from "vitest";
import { useCanvasStore } from "./canvas";

// The store is a module singleton, so it carries state between tests. Snapshot
// it before anything runs and replace it wholesale each time. The snapshot
// holds the actions too, so replacing keeps them.
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

test("starts with nothing placed or selected", () => {
  expect(state().positions).toEqual({});
  expect(state().selectedIds).toEqual([]);
});

test("places the first block exactly where it is dropped", () => {
  state().placeBlock("a", { x: 120, y: 40 });

  expect(state().positions.a).toEqual({ x: 120, y: 40 });
});

test("cascades blocks dropped on the same point", () => {
  state().placeBlock("a", { x: 0, y: 0 });
  state().placeBlock("b", { x: 0, y: 0 });

  expect(state().positions.b).not.toEqual(state().positions.a);
});

test("moves a block to exactly where it is dragged", () => {
  state().placeBlock("a", { x: 0, y: 0 });
  state().moveBlock("a", { x: -60, y: 300 });

  expect(state().positions.a).toEqual({ x: -60, y: 300 });
});

test("leaves the other blocks where they are on a move", () => {
  state().placeBlock("a", { x: 0, y: 0 });
  state().placeBlock("b", { x: 0, y: 0 });
  const before = state().positions.a;

  state().moveBlock("b", { x: 500, y: 500 });

  expect(state().positions.a).toEqual(before);
});

test("adds and drops ids from the selection", () => {
  state().selectBlock("a", true);
  state().selectBlock("b", true);
  expect(state().selectedIds).toEqual(["a", "b"]);

  state().selectBlock("a", false);
  expect(state().selectedIds).toEqual(["b"]);
});

test("ignores a selection change that changes nothing", () => {
  state().selectBlock("a", true);
  const before = state().selectedIds;

  state().selectBlock("a", true);
  state().selectBlock("b", false);

  expect(state().selectedIds).toBe(before);
});
