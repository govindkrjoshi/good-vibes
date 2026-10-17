import type { Edge } from "@xyflow/react";
import { expect, test } from "vitest";
import {
  layoutNodes,
  syncNodesFromRack,
  toFlowEdges,
  type BlockNodeType as BlockNode,
  type CanvasNode,
} from ".";
import {
  makeBlock,
  rootRack,
  type Jack,
  type ParamGroup,
  type Patch,
  type Rack,
} from "../rack";
import { volume } from "../catalogue/common";

const rack = (
  children: readonly Rack[],
  patches: readonly string[] = [],
): Record<string, Rack> => ({
  root: {
    ...rootRack,
    children: children.map((block) => block.id),
    patches,
  },
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

const sync = (
  blocks: Record<string, Rack>,
  current: readonly CanvasNode[] = [],
  jacks: Record<string, Jack> = {},
  paramGroups: Record<string, ParamGroup> = {},
) => syncNodesFromRack(current, blocks, jacks, paramGroups, "root");

const held = (id: string, overrides: Partial<BlockNode> = {}): BlockNode => ({
  id,
  type: "block",
  position: { x: 100, y: 200 },
  measured: { width: 176, height: 44 },
  selected: true,
  data: { name: "stale", kind: "leaf", jacks: [] },
  ...overrides,
});

test("renders nothing while the rack is still empty", () => {
  expect(sync({ root: rootRack })).toEqual([]);
});

test("gives every block under the root a node", () => {
  const leaf = makeBlock("a", "root", "leaf");
  const group = makeBlock("b", "root", "tree");

  const nodes = sync(rack([leaf, group]));

  expect(nodes.map((flow) => flow.id)).toEqual(["a", "b"]);
  expect(
    nodes.map((flow) => (flow.type === "block" ? flow.data.kind : undefined)),
  ).toEqual(["leaf", "tree"]);
  expect(nodes.every((flow) => flow.type === "block")).toBe(true);
});

test("starts a new block at the origin", () => {
  const [node] = sync(rack([makeBlock("a", "root", "leaf")]));

  expect(node.position).toEqual({ x: 0, y: 0 });
});

test("keeps where React Flow has put an existing block", () => {
  const [node] = sync(rack([makeBlock("a", "root", "leaf")]), [held("a")]);

  expect(node.position).toEqual({ x: 100, y: 200 });
});

test("keeps what React Flow measured an existing block at", () => {
  const [node] = sync(rack([makeBlock("a", "root", "leaf")]), [held("a")]);

  expect(node.measured).toEqual({ width: 176, height: 44 });
});

test("keeps an existing block selected", () => {
  const [node] = sync(rack([makeBlock("a", "root", "leaf")]), [held("a")]);

  expect(node.selected).toBe(true);
});

test("keeps React Flow's own bookkeeping on an existing block", () => {
  const [node] = sync(rack([makeBlock("a", "root", "leaf")]), [
    held("a", { dragging: true }),
  ]);

  expect(node.dragging).toBe(true);
});

test("updates the name of an existing block", () => {
  const block = { ...makeBlock("a", "root", "leaf"), name: "Renamed" };

  const [node] = sync(rack([block]), [held("a")]);

  expect(node.data.name).toBe("Renamed");
});

test("resolves a block's jacks so it can grow handles", () => {
  const block = { ...makeBlock("a", "root", "leaf"), jackIds: ["in1", "gone"] };
  const jacks = { in1: jack("in1", "a", "in") };

  const [node] = sync(rack([block]), [], jacks);

  expect(node.data.jacks).toEqual([jacks.in1]);
});

test("updates the jacks of an existing block", () => {
  const jacks = {
    in1: jack("in1", "a", "in"),
    out1: jack("out1", "a", "out"),
  };
  const before = { ...makeBlock("a", "root", "leaf"), jackIds: ["in1"] };
  const after = { ...before, jackIds: ["out1"] };

  const [first] = sync(rack([before]), [], jacks);
  const [node] = sync(
    rack([after]),
    [{ ...first, position: { x: 9, y: 9 } }],
    jacks,
  );

  expect(node.data.jacks).toEqual([jacks.out1]);
  expect(node.position).toEqual({ x: 9, y: 9 });
});

test("drops nodes for blocks no longer under the root", () => {
  const nodes = sync(rack([makeBlock("a", "root", "leaf")]), [
    held("a"),
    held("gone"),
  ]);

  expect(nodes.map((flow) => flow.id)).toEqual(["a"]);
});

test("adds a node for a block that has just arrived", () => {
  const nodes = sync(
    rack([makeBlock("a", "root", "leaf"), makeBlock("b", "root", "leaf")]),
    [held("a")],
  );

  expect(nodes.map((flow) => flow.id)).toEqual(["a", "b"]);
  expect(nodes[1].position).toBeDefined();
  expect(nodes[1].selected).toBeUndefined();
});

test("skips a child id with no block behind it", () => {
  expect(sync({ root: { ...rootRack, children: ["ghost"] } })).toEqual([]);
});

test("leaves a new block for React Flow to size", () => {
  const [node] = sync(rack([makeBlock("a", "root", "leaf")]));

  expect(node.measured).toBeUndefined();
  expect(node.width).toBeUndefined();
  expect(node.height).toBeUndefined();
});

const edge = (source: string, target: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
});

test("stacks blocks with no patches between them in a column", () => {
  const [a, b] = layoutNodes([held("a"), held("b")], []);

  expect(a.position.x).toBe(b.position.x);
  expect(Math.abs(a.position.y - b.position.y)).toBeGreaterThanOrEqual(44);
});

test("lays a patched block out to the right of what feeds it", () => {
  const [a, b] = layoutNodes([held("a"), held("b")], [edge("a", "b")]);

  expect(b.position.x).toBeGreaterThanOrEqual(a.position.x + 176);
});

test("keeps everything but the position when laying out", () => {
  const [node] = layoutNodes([held("a")], []);

  expect({ ...node, position: undefined }).toEqual({
    ...held("a"),
    position: undefined,
  });
});

const twoBlocks = () =>
  rack([makeBlock("a", "root", "leaf"), makeBlock("b", "root", "leaf")], ["p"]);

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

test("gives a block with params or methods a panel of controls", () => {
  const plain = makeBlock("a", "root", "leaf");
  const synth = {
    ...makeBlock("b", "root", "leaf"),
    name: "AMSynth",
    methodIds: ["b:method:triggerAttack"],
  };

  const [box, panel] = sync(rack([plain, synth]));

  expect(box.type).toBe("block");
  expect(panel.type).toBe("rack");
  expect(panel.data).toEqual({ blockId: "b", name: "AMSynth", jacks: [] });
});

test("gives a block whose param group holds params a panel of controls", () => {
  const empty = { ...makeBlock("a", "root", "leaf"), paramGroupId: "a:group" };
  const nested = { ...makeBlock("b", "root", "leaf"), paramGroupId: "b:group" };
  const paramGroups: Record<string, ParamGroup> = {
    "a:group": { id: "a:group", groups: { none: { id: "a:none" } } },
    "b:group": {
      id: "b:group",
      groups: { amp: { id: "b:amp", params: [volume("b")] } },
    },
  };

  const [box, panel] = sync(rack([empty, nested]), [], {}, paramGroups);

  expect(box.type).toBe("block");
  expect(panel.type).toBe("rack");
});
