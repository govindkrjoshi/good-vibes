import { expect, test } from "vitest";
import { instantiate } from "../catalogue/instantiate";
import { defineItem, output, toneCode } from "../catalogue/kit";
import { newTree, rootRack, type Jack, type Patch, type Rack } from "../rack";
import { arrange, layoutColumns, layoutGap } from "./layout";
import { syncNodesFromRack } from "./graph";
import { treeInset, treeNodeWidth, type CanvasNode } from "./nodes";

const box = defineItem("components", "Box", {
  description: "Passes signal through.",
  code: toneCode("new tone.Gain()"),
});

const source = defineItem("sources", "Source", {
  description: "Makes signal.",
  code: toneCode("new tone.Signal()"),
  jacks: [output()],
});

// Racks placed by id, each a leaf under `parentId` (the root by default), and
// cables between them as `from>to` pairs of rack ids.
const build = (
  leaves: readonly (readonly [string, string?, typeof box?])[],
  cables: readonly string[],
  trees: readonly string[] = [],
) => {
  const racks: Record<string, Rack> = {
    root: { ...rootRack, children: [] },
  };
  const jacks: Record<string, Jack> = {};
  const patches: Record<string, Patch> = {};
  const parentOf = (id: string, parentId: string) => {
    const parent = racks[parentId]!;
    if (parent.type === "tree") {
      racks[parentId] = { ...parent, children: [...parent.children, id] };
    }
  };
  for (const id of trees) {
    racks[id] = {
      ...newTree(id, "root"),
      jackIds: [`${id}:in`, `${id}:out`],
    };
    jacks[`${id}:in`] = {
      id: `${id}:in`,
      name: "In",
      belongToBlockId: id,
      direction: "in",
    };
    jacks[`${id}:out`] = {
      id: `${id}:out`,
      name: "Out",
      belongToBlockId: id,
      direction: "out",
    };
    parentOf(id, "root");
  }
  for (const [id, parentId = "root", item = box] of leaves) {
    const placed = instantiate(item, id);
    racks[id] = { ...placed.rack, parentId };
    Object.assign(jacks, placed.jacks);
    parentOf(id, parentId);
  }
  cables.forEach((cable, index) => {
    const [from, to] = cable.split(">") as [string, string];
    const fromJack = from.includes(":") ? from : `${from}:out`;
    const toJack = to.includes(":") ? to : `${to}:in`;
    const id = `p${index}`;
    patches[id] = { id, name: id, from: fromJack, to: toJack };
    const scopeId =
      jacks[fromJack]!.direction === "out" && jacks[toJack]!.direction === "in"
        ? racks[jacks[fromJack]!.belongToBlockId]!.parentId!
        : jacks[fromJack]!.direction === "in"
          ? jacks[fromJack]!.belongToBlockId
          : jacks[toJack]!.belongToBlockId;
    const scope = racks[scopeId]!;
    if (scope.type === "tree") {
      racks[scopeId] = { ...scope, patches: [...scope.patches, id] };
    }
  });
  return { racks, jacks, patches };
};

// Nodes as React Flow would hold them once drawn, each measured 360 by `height`.
const drawn = (
  state: ReturnType<typeof build>,
  heights: Readonly<Record<string, number>> = {},
): CanvasNode[] =>
  syncNodesFromRack([], state.racks, state.jacks, {}, "root").map((node) =>
    node.type === "tree"
      ? node
      : { ...node, measured: { width: 360, height: heights[node.id] ?? 200 } },
  );

const positions = (nodes: readonly CanvasNode[]) =>
  Object.fromEntries(nodes.map((node) => [node.id, node.position]));

test("puts each rack one column right of what feeds it", () => {
  const state = build(
    [["s", "root", source], ["a"], ["b"], ["c"]],
    ["s>a", "a>b", "b>c"],
  );

  const { nodes, bounds } = arrange(
    drawn(state),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );
  const at = positions(nodes);
  const step = 360 + layoutGap.x;

  expect(at.s).toEqual({ x: 0, y: 0 });
  expect(at.a).toEqual({ x: step, y: 0 });
  expect(at.b).toEqual({ x: 2 * step, y: 0 });
  expect(at.c).toEqual({ x: 3 * step, y: 0 });
  expect(bounds).toEqual({
    x: 0,
    y: 0,
    width: 4 * step - layoutGap.x,
    height: 200,
  });
});

test("stacks racks that share a column and centres the shorter columns", () => {
  const state = build(
    [["s", "root", source], ["a"], ["b"], ["sum"]],
    ["s>a", "s>b", "a>sum", "b>sum"],
  );

  const { nodes } = arrange(
    drawn(state),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );
  const at = positions(nodes);
  const middle = 200 + layoutGap.y;

  expect(at.a).toEqual({ x: 360 + layoutGap.x, y: 0 });
  expect(at.b).toEqual({ x: 360 + layoutGap.x, y: 200 + layoutGap.y });
  // The lone racks sit level with the middle of the pair.
  expect(at.s!.y).toBeCloseTo(middle / 2);
  expect(at.sum!.y).toBeCloseTo(middle / 2);
});

test("carries a long chain on in a row below", () => {
  const ids = Array.from({ length: layoutColumns + 2 }, (_, i) => `r${i}`);
  const state = build(
    ids.map((id) => [id] as const),
    ids.slice(1).map((id, i) => `${ids[i]}>${id}`),
  );

  const { nodes, bounds } = arrange(
    drawn(state),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );
  const at = positions(nodes);
  const step = 360 + layoutGap.x;

  expect(at[`r${layoutColumns - 1}`]).toEqual({
    x: (layoutColumns - 1) * step,
    y: 0,
  });
  expect(at[`r${layoutColumns}`]).toEqual({ x: 0, y: 200 + layoutGap.y });
  expect(at[`r${layoutColumns + 1}`]).toEqual({
    x: step,
    y: 200 + layoutGap.y,
  });
  expect(bounds.width).toBe(layoutColumns * step - layoutGap.x);
  expect(bounds.height).toBe(2 * 200 + layoutGap.y);
});

test("keeps a loop from pushing a rack off into the distance", () => {
  const state = build([["a"], ["b"]], ["a>b", "b>a"]);

  const { nodes } = arrange(
    drawn(state),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );
  const at = positions(nodes);

  expect([at.a!.x, at.b!.x].sort((a, b) => a - b)).toEqual([
    0,
    360 + layoutGap.x,
  ]);
  expect([at.a!.y, at.b!.y]).toEqual([0, 0]);
});

test("lays a tree's children out inside it and grows the tree around them", () => {
  const state = build(
    [["a", "g"], ["b", "g"], ["d"]],
    ["g:in>a", "a>b", "b>g:out", "g>d"],
    ["g"],
  );

  const { nodes } = arrange(
    drawn(state, { a: 100, b: 300 }),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  const tree = byId.g!;
  const top = 56 + 28;

  // Children sit past the inset, clear of the header and its jacks.
  expect(byId.a!.position).toEqual({ x: treeInset, y: top + 100 });
  expect(byId.b!.position).toEqual({
    x: treeInset + 360 + layoutGap.x,
    y: top,
  });
  expect(tree.width).toBe(treeInset + 2 * 360 + layoutGap.x + treeInset);
  expect(tree.height).toBe(top + 300 + treeInset);
  // The tree is a rack in its parent's layout, at its grown size.
  expect(tree.position).toEqual({ x: 0, y: 0 });
  expect(byId.d!.position.x).toBe(tree.width! + layoutGap.x);
});

test("gives an empty tree its default size", () => {
  const state = build([], [], ["g"]);

  const { nodes } = arrange(
    drawn(state),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );

  expect(nodes[0]?.width).toBe(treeNodeWidth);
  expect(nodes[0]?.height).toBe(280);
});

test("keeps the nodes in the order it was given", () => {
  const state = build([["a"], ["b"], ["c"]], ["c>b", "b>a"]);

  const { nodes } = arrange(
    drawn(state),
    state.racks,
    state.jacks,
    state.patches,
    "root",
  );

  expect(nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
});
