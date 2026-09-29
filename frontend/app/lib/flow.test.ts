import { expect, test } from "vitest";
import { toFlowEdges, toFlowNodes } from "./flow";
import {
  emptyRack,
  makeBlock,
  toTree,
  type Jack,
  type Patch,
  type Rack,
} from "~/types/rack";

/** A root tree holding `children` and `patches`, shaped like the rack store
 * builds it. */
const rack = (
  children: readonly Rack[],
  patches: readonly string[] = [],
): Record<string, Rack> => ({
  root: toTree(
    emptyRack,
    children.map((block) => block.id),
    patches,
  ),
  ...Object.fromEntries(children.map((block) => [block.id, block])),
});

const jack = (id: string, blockId: string, direction: "in" | "out"): Jack => ({
  id,
  name: id,
  belongToBlockId: blockId,
  direction,
});

const patch = (id: string, from: string, to: string): Patch => ({
  id,
  name: id,
  from,
  to,
});

test("renders nothing while the rack is still empty", () => {
  const blocks = { root: emptyRack };

  expect(toFlowNodes(blocks, {}, "root", {}, {}, [])).toEqual([]);
});

test("gives every block under the root a node", () => {
  const node = makeBlock("a", "root", "node");
  const group = makeBlock("b", "root", "tree");

  const nodes = toFlowNodes(rack([node, group]), {}, "root", {}, {}, []);

  expect(nodes.map((flow) => flow.id)).toEqual(["a", "b"]);
  expect(nodes.map((flow) => flow.data.kind)).toEqual(["node", "tree"]);
  expect(nodes.every((flow) => flow.type === "block")).toBe(true);
});

test("puts each block where the canvas placed it", () => {
  const blocks = rack([makeBlock("a", "root", "node")]);
  const positions = { a: { x: 12, y: 34 } };

  expect(
    toFlowNodes(blocks, {}, "root", positions, {}, [])[0].position,
  ).toEqual({
    x: 12,
    y: 34,
  });
});

test("falls back to the origin for a block with no position yet", () => {
  const blocks = rack([makeBlock("a", "root", "node")]);

  expect(toFlowNodes(blocks, {}, "root", {}, {}, [])[0].position).toEqual({
    x: 0,
    y: 0,
  });
});

test("marks the selected blocks", () => {
  const blocks = rack([
    makeBlock("a", "root", "node"),
    makeBlock("b", "root", "node"),
  ]);

  const nodes = toFlowNodes(blocks, {}, "root", {}, {}, ["b"]);

  expect(nodes.map((flow) => flow.selected)).toEqual([false, true]);
});

test("resolves a block's jacks so it can grow handles", () => {
  const block = { ...makeBlock("a", "root", "node"), jackIds: ["in1", "gone"] };
  const jacks = { in1: jack("in1", "a", "in") };

  const [node] = toFlowNodes(rack([block]), jacks, "root", {}, {}, []);

  expect(node.data.jacks).toEqual([jacks.in1]);
});

test("skips a child id with no block behind it", () => {
  const blocks = { root: toTree(emptyRack, ["ghost"], []) };

  expect(toFlowNodes(blocks, {}, "root", {}, {}, [])).toEqual([]);
});

test("hands React Flow back the size it measured a block at", () => {
  const blocks = rack([makeBlock("a", "root", "node")]);
  const dimensions = { a: { width: 176, height: 44 } };

  const [node] = toFlowNodes(blocks, {}, "root", {}, dimensions, []);

  expect(node.measured).toEqual({ width: 176, height: 44 });
  // Author-set sizes land as inline styles and would pin the block at this
  // measurement, so the block carries only what was measured.
  expect(node.width).toBeUndefined();
  expect(node.height).toBeUndefined();
});

test("leaves a block React Flow has not measured yet unsized", () => {
  const blocks = rack([makeBlock("a", "root", "node")]);

  const [node] = toFlowNodes(blocks, {}, "root", {}, {}, []);

  expect(node.measured).toBeUndefined();
});

const twoBlocks = () =>
  rack([makeBlock("a", "root", "node"), makeBlock("b", "root", "node")], ["p"]);

test("renders patches as edges between output and input handles", () => {
  const jacks = {
    out: jack("out", "a", "out"),
    in: jack("in", "b", "in"),
  };

  expect(
    toFlowEdges(twoBlocks(), jacks, { p: patch("p", "out", "in") }, "root"),
  ).toEqual([
    {
      id: "p",
      source: "a",
      sourceHandle: "out",
      target: "b",
      targetHandle: "in",
    },
  ]);
});

test("skips patches that do not go from an output to another block's input", () => {
  const jacks = {
    out: jack("out", "a", "out"),
    otherOut: jack("otherOut", "b", "out"),
  };

  expect(
    toFlowEdges(
      twoBlocks(),
      jacks,
      { p: patch("p", "out", "otherOut") },
      "root",
    ),
  ).toEqual([]);
});

test("skips a patch that loops a block back to itself", () => {
  const jacks = {
    out: jack("out", "a", "out"),
    in: jack("in", "a", "in"),
  };

  expect(
    toFlowEdges(twoBlocks(), jacks, { p: patch("p", "out", "in") }, "root"),
  ).toEqual([]);
});

test("skips a patch onto a block that is not on this canvas", () => {
  const jacks = {
    out: jack("out", "a", "out"),
    in: jack("in", "elsewhere", "in"),
  };

  expect(
    toFlowEdges(twoBlocks(), jacks, { p: patch("p", "out", "in") }, "root"),
  ).toEqual([]);
});

test("skips a patch id with no patch behind it", () => {
  const jacks = { out: jack("out", "a", "out"), in: jack("in", "b", "in") };

  expect(toFlowEdges(twoBlocks(), jacks, {}, "root")).toEqual([]);
});
