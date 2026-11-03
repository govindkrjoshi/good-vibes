import { expect, test } from "vitest";
import {
  fitTrees,
  jackIds,
  syncNodesFromRack,
  toFlowEdges,
  treeAt,
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
  data: { name: "stale", jacks: [] },
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
  expect(nodes.map((flow) => flow.type)).toEqual(["block", "tree"]);
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
  expect(panel.data).toEqual({ name: "AMSynth", jacks: [] });
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

const nested = () => {
  const tree = {
    ...makeBlock("t", "root", "tree"),
    children: ["a"],
  } as Rack;
  const leaf = makeBlock("a", "t", "leaf");
  return {
    root: { ...rootRack, children: ["t"] },
    t: tree,
    a: leaf,
  };
};

test("draws a rack inside a tree after the tree, as its child", () => {
  const nodes = sync(nested());

  expect(nodes.map((node) => [node.id, node.parentId])).toEqual([
    ["t", undefined],
    ["a", "t"],
  ]);
});

test("gives a tree the room to hold racks and counts what it holds", () => {
  const [tree] = sync(nested());

  expect(tree?.width).toBe(420);
  expect(tree?.height).toBe(280);
  expect(tree?.type === "tree" && tree.data.childCount).toBe(1);
});

test("keeps a rack in place on the canvas when it moves into a tree", () => {
  const tree = sync(nested())[0] as CanvasNode;
  const nodes = sync(nested(), [
    { ...tree, position: { x: 50, y: 60 } },
    held("a", { position: { x: 150, y: 200 } }),
  ]);

  expect(nodes[1]?.position).toEqual({ x: 100, y: 140 });
});

test("keeps a rack in place on the canvas when it moves out of a tree", () => {
  const tree = sync(nested())[0] as CanvasNode;
  const blocks = {
    root: { ...rootRack, children: ["t", "a"] },
    t: { ...nested().t, children: [] } as Rack,
    a: makeBlock("a", "root", "leaf"),
  };
  const nodes = sync(blocks, [
    { ...tree, position: { x: 50, y: 60 } },
    held("a", { parentId: "t", position: { x: 100, y: 140 } }),
  ]);

  expect(nodes[1]?.position).toEqual({ x: 150, y: 200 });
  expect(nodes[1]?.parentId).toBeUndefined();
});

test("grows a tree around its children but never shrinks it", () => {
  const tree = sync(nested())[0] as CanvasNode;
  const child = held("a", {
    parentId: "t",
    position: { x: 400, y: 100 },
    measured: { width: 100, height: 20 },
  });

  const [fitted] = fitTrees([tree, child]);

  expect(fitted?.width).toBe(524);
  expect(fitted?.height).toBe(280);
});

test("keeps children clear of a tree's edges and header", () => {
  const tree = sync(nested())[0] as CanvasNode;
  const child = held("a", { parentId: "t", position: { x: -10, y: 5 } });

  expect(fitTrees([tree, child])[1]?.position).toEqual({ x: 24, y: 56 });
});

test("grows a tree around a nested tree that grew", () => {
  const outer = sync(nested())[0] as CanvasNode;
  const inner = {
    ...outer,
    id: "inner",
    parentId: "t",
    position: { x: 24, y: 56 },
  };
  const leaf = held("a", {
    parentId: "inner",
    position: { x: 500, y: 56 },
    measured: { width: 100, height: 20 },
  });

  const [fittedOuter, fittedInner] = fitTrees([outer, inner, leaf]);

  expect(fittedInner?.width).toBe(624);
  expect(fittedOuter?.width).toBe(672);
});

test("finds the innermost tree under a point", () => {
  const outer = sync(nested())[0] as CanvasNode;
  const inner = {
    ...outer,
    id: "inner",
    parentId: "t",
    position: { x: 24, y: 56 },
  };
  const nodes = [outer, inner];

  expect(treeAt(nodes, { x: 30, y: 60 }, {}, [])).toBe("inner");
  expect(treeAt(nodes, { x: 10, y: 10 }, {}, [])).toBe("t");
  expect(treeAt(nodes, { x: 900, y: 10 }, {}, [])).toBeUndefined();
});

test("won't drop a tree into itself or a tree inside it", () => {
  const outer = sync(nested())[0] as CanvasNode;
  const inner = {
    ...outer,
    id: "inner",
    parentId: "t",
    position: { x: 24, y: 56 },
  };
  const racks = {
    t: makeBlock("t", "root", "tree"),
    inner: makeBlock("inner", "t", "tree"),
  };

  expect(
    treeAt([outer, inner], { x: 30, y: 60 }, racks, ["t"]),
  ).toBeUndefined();
});

test("grows a tree to list its jacks", () => {
  const tree = sync(nested())[0] as CanvasNode;
  const jacks = Array.from({ length: 12 }, (_, i) => jack(`j${i}`, "t", "in"));

  const [fitted] = fitTrees([
    { ...tree, data: { name: "Group", jacks, childCount: 0 } } as CanvasNode,
  ]);

  expect(fitted?.height).toBe(56 + 12 * 28);
});

test("keeps children below a tree's jacks", () => {
  const tree = sync(nested())[0] as CanvasNode;
  const jacks = [jack("j", "t", "in"), jack("k", "t", "in")];
  const child = held("a", { parentId: "t", position: { x: 30, y: 60 } });

  const fitted = fitTrees([
    { ...tree, data: { name: "Group", jacks, childCount: 1 } } as CanvasNode,
    child,
  ]);

  expect(fitted[1]?.position).toEqual({ x: 30, y: 56 + 2 * 28 });
});

test("draws a tree's patches to its children from the sockets inside it", () => {
  const blocks: Record<string, Rack> = {
    root: { ...rootRack, children: ["t"] },
    t: {
      ...makeBlock("t", "root", "tree"),
      type: "tree",
      children: ["a"],
      patches: ["in", "out"],
    } as Rack,
    a: makeBlock("a", "t", "leaf"),
  };
  const jacks = {
    tIn: jack("tIn", "t", "in"),
    tOut: jack("tOut", "t", "out"),
    aIn: jack("aIn", "a", "in"),
    aOut: jack("aOut", "a", "out"),
  };
  const patches = {
    in: patch("in", "tIn", "aIn"),
    out: patch("out", "aOut", "tOut"),
  };

  const edges = toFlowEdges(blocks, jacks, patches, "root");

  expect(edges).toEqual([
    {
      id: "in",
      source: "t",
      sourceHandle: "inside:tIn",
      target: "a",
      targetHandle: "aIn",
    },
    {
      id: "out",
      source: "a",
      sourceHandle: "aOut",
      target: "t",
      targetHandle: "inside:tOut",
    },
  ]);
  expect(edges.map(jackIds)).toEqual([
    ["tIn", "aIn"],
    ["aOut", "tOut"],
  ]);
});
