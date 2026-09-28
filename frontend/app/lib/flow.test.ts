import { expect, test } from "vitest";
import { toFlowNodes } from "./flow";
import {
  emptyRack,
  makeBlock,
  toTree,
  type Jack,
  type Rack,
} from "~/types/rack";

/** A root tree holding `children`, shaped like the rack store builds it. */
const rack = (children: readonly Rack[]): Record<string, Rack> => ({
  root: toTree(
    emptyRack,
    children.map((block) => block.id),
    [],
  ),
  ...Object.fromEntries(children.map((block) => [block.id, block])),
});

const jack = (id: string, blockId: string, direction: "in" | "out"): Jack => ({
  id,
  name: id,
  belongToBlockId: blockId,
  direction,
});

test("renders nothing while the rack is still empty", () => {
  const blocks = { root: emptyRack };

  expect(toFlowNodes(blocks, {}, "root", {}, [])).toEqual([]);
});

test("gives every block under the root a node", () => {
  const node = makeBlock("a", "root", "node");
  const group = makeBlock("b", "root", "tree");

  const nodes = toFlowNodes(rack([node, group]), {}, "root", {}, []);

  expect(nodes.map((flow) => flow.id)).toEqual(["a", "b"]);
  expect(nodes.map((flow) => flow.data.kind)).toEqual(["node", "tree"]);
  expect(nodes.every((flow) => flow.type === "block")).toBe(true);
});

test("puts each block where the canvas placed it", () => {
  const blocks = rack([makeBlock("a", "root", "node")]);
  const positions = { a: { x: 12, y: 34 } };

  expect(toFlowNodes(blocks, {}, "root", positions, [])[0].position).toEqual({
    x: 12,
    y: 34,
  });
});

test("falls back to the origin for a block with no position yet", () => {
  const blocks = rack([makeBlock("a", "root", "node")]);

  expect(toFlowNodes(blocks, {}, "root", {}, [])[0].position).toEqual({
    x: 0,
    y: 0,
  });
});

test("marks the selected blocks", () => {
  const blocks = rack([
    makeBlock("a", "root", "node"),
    makeBlock("b", "root", "node"),
  ]);

  const nodes = toFlowNodes(blocks, {}, "root", {}, ["b"]);

  expect(nodes.map((flow) => flow.selected)).toEqual([false, true]);
});

test("resolves a block's jacks so it can grow handles", () => {
  const block = { ...makeBlock("a", "root", "node"), jackIds: ["in1", "gone"] };
  const jacks = { in1: jack("in1", "a", "in") };

  const [node] = toFlowNodes(rack([block]), jacks, "root", {}, []);

  expect(node.data.jacks).toEqual([jacks.in1]);
});

test("skips a child id with no block behind it", () => {
  const blocks = { root: toTree(emptyRack, ["ghost"], []) };

  expect(toFlowNodes(blocks, {}, "root", {}, [])).toEqual([]);
});
