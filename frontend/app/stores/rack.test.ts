import { Effect } from "effect";
import { beforeEach, expect, test } from "vitest";
import { useRackStore } from "./rack";

// The store is a module singleton, so it carries state between tests. Snapshot
// it before anything runs and replace it wholesale each time. The snapshot
// holds the actions too, so replacing keeps them.
const initial = useRackStore.getState();

const state = () => useRackStore.getState();
const root = () => state().blocks[state().rootId];

const children = () => {
  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  return block.children;
};

beforeEach(() => {
  useRackStore.setState(initial, true);
});

test("starts as a single empty root block", () => {
  expect(state().rootId).toBe("root");
  expect(Object.keys(state().blocks)).toEqual(["root"]);
  expect(root().type).toBe("empty");
  expect(root().isRoot).toBe(true);
  expect(state().jacks).toEqual({});
  expect(state().patches).toEqual({});
});

test("turns the empty root into a tree for the first block", () => {
  state().addBlock("node");

  expect(root().type).toBe("tree");
  expect(root().id).toBe("root");
  expect(root().isRoot).toBe(true);
  expect(children()).toHaveLength(1);
});

test("files each new block under the root and keeps insertion order", () => {
  state().addBlock("node");
  state().addBlock("tree");

  const [first, second] = children();
  expect(children()).toHaveLength(2);
  expect(first).not.toBe(second);
  expect(state().blocks[first].type).toBe("node");
  expect(state().blocks[second].type).toBe("tree");
});

test("points every added block back at its parent", () => {
  state().addBlock("tree");

  const block = state().blocks[children()[0]];
  expect(block.parentId).toBe("root");
  expect(block.isRoot).toBe(false);
});

test("gives a node block an Effect to run", () => {
  state().addBlock("node");

  const block = state().blocks[children()[0]];
  if (block.type !== "node") throw new Error("expected a node block");
  expect(Effect.isEffect(block.code)).toBe(true);
});

test("gives a group block its own empty children and patches", () => {
  state().addBlock("tree");

  const block = state().blocks[children()[0]];
  if (block.type !== "tree") throw new Error("expected a tree block");
  expect(block.children).toEqual([]);
  expect(block.patches).toEqual([]);
});

test("hands back the id of the block it added", () => {
  const id = state().addBlock("node");

  expect(id).toBeTypeOf("string");
  expect(children()).toEqual([id]);
});

test("leaves the rack alone when run is called", () => {
  state().addBlock("node");
  const before = state().blocks;

  state().run();

  expect(state().blocks).toBe(before);
});
