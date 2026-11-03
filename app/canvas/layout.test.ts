import { expect, test } from "vitest";
import { instantiate } from "../catalogue/instantiate";
import { defineItem, output, toneCode } from "../catalogue/kit";
import { newTree, rootRack, type Jack, type Patch, type Rack } from "../rack";
import { applyLayout, layoutGap, layoutNodes } from "./layout";
import { syncNodesFromRack, toFlowEdges } from "./graph";
import {
  treeInset,
  treeNodeHeight,
  treeNodeWidth,
  type CanvasNode,
} from "./nodes";

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

// Nodes and edges as React Flow would hold them once drawn, each rack
// measured 360 by `height`.
const drawn = (
  state: ReturnType<typeof build>,
  heights: Readonly<Record<string, number>> = {},
) => ({
  nodes: syncNodesFromRack([], state.racks, state.jacks, {}, "root").map(
    (node): CanvasNode =>
      node.type === "tree"
        ? node
        : {
            ...node,
            measured: { width: 360, height: heights[node.id] ?? 200 },
          },
  ),
  edges: toFlowEdges(state.racks, state.jacks, state.patches, "root"),
});

const layout = async (
  state: ReturnType<typeof build>,
  heights?: Readonly<Record<string, number>>,
) => {
  const { nodes, edges } = drawn(state, heights);
  return layoutNodes(nodes, edges);
};

const byIdOf = (nodes: readonly CanvasNode[]) =>
  Object.fromEntries(nodes.map((node) => [node.id, node]));

const sizeOf = (node: CanvasNode) => ({
  width: node.width ?? node.measured?.width ?? 0,
  height: node.height ?? node.measured?.height ?? 0,
});

const overlap = (a: CanvasNode, b: CanvasNode) => {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  return (
    a.position.x < b.position.x + sb.width &&
    b.position.x < a.position.x + sa.width &&
    a.position.y < b.position.y + sb.height &&
    b.position.y < a.position.y + sa.height
  );
};

test("puts each rack a column right of what feeds it", async () => {
  const state = build(
    [["s", "root", source], ["a"], ["b"], ["c"]],
    ["s>a", "a>b", "b>c"],
  );

  const { nodes, bounds } = await layout(state);
  const at = byIdOf(nodes);
  const step = 360 + layoutGap.x;

  expect(at.s!.position.x).toBe(0);
  expect(at.a!.position.x).toBe(step);
  expect(at.b!.position.x).toBe(2 * step);
  expect(at.c!.position.x).toBe(3 * step);
  expect(bounds.width).toBe(4 * step - layoutGap.x);
});

test("stacks racks that share a column without overlapping", async () => {
  const state = build(
    [["s", "root", source], ["a"], ["b"], ["sum"]],
    ["s>a", "s>b", "a>sum", "b>sum"],
  );

  const { nodes } = await layout(state);
  const at = byIdOf(nodes);

  expect(at.a!.position.x).toBe(at.b!.position.x);
  expect(Math.abs(at.a!.position.y - at.b!.position.y)).toBeGreaterThanOrEqual(
    200 + layoutGap.y,
  );
  expect(at.sum!.position.x).toBeGreaterThan(at.a!.position.x);
});

test("puts racks that aren't cabled side by side, in the order they came", async () => {
  const state = build([["a"], ["b"], ["c"]], []);

  const { nodes } = await layout(state, { b: 400 });
  const at = byIdOf(nodes);
  const step = 360 + layoutGap.x;

  expect(at.a!.position).toEqual({ x: 0, y: 0 });
  expect(at.b!.position).toEqual({ x: step, y: 0 });
  expect(at.c!.position).toEqual({ x: 2 * step, y: 0 });
});

test("puts a new rack right of a chain, ready to be cabled", async () => {
  const state = build([["a"], ["b"], ["new"]], ["a>b"]);

  const { nodes } = await layout(state);
  const at = byIdOf(nodes);

  expect(at.b!.position.x).toBeGreaterThan(at.a!.position.x);
  expect(at.new!.position.x).toBeGreaterThan(at.b!.position.x + 360);
});

test("puts racks side by side inside a tree too", async () => {
  const state = build(
    [
      ["a", "g"],
      ["b", "g"],
    ],
    [],
    ["g"],
  );

  const { nodes } = await layout(state);
  const at = byIdOf(nodes);

  expect(at.a!.position.y).toBe(at.b!.position.y);
  expect(at.b!.position.x).toBe(at.a!.position.x + 360 + layoutGap.x);
});

test("lays out a loop", async () => {
  const state = build([["a"], ["b"]], ["a>b", "b>a"]);

  const { nodes } = await layout(state);
  const at = byIdOf(nodes);

  expect(Math.abs(at.a!.position.x - at.b!.position.x)).toBe(360 + layoutGap.x);
});

test("lays a tree's children out inside it and grows the tree around them", async () => {
  const state = build(
    [["a", "g"], ["b", "g"], ["d"]],
    ["g:in>a", "a>b", "b>g:out", "g>d"],
    ["g"],
  );

  const { nodes } = await layout(state, { a: 100, b: 300 });
  const at = byIdOf(nodes);
  const tree = at.g!;
  const top = 56 + 28;

  // Children sit past the inset, clear of the header and its jacks.
  for (const id of ["a", "b"]) {
    const child = at[id]!;
    expect(child.parentId).toBe("g");
    expect(child.position.x).toBeGreaterThanOrEqual(treeInset);
    expect(child.position.y).toBeGreaterThanOrEqual(top);
    expect(child.position.x + 360).toBeLessThanOrEqual(tree.width! - treeInset);
    expect(child.position.y + sizeOf(child).height).toBeLessThanOrEqual(
      tree.height! - treeInset,
    );
  }
  // What comes in through the tree's input reaches the first child first.
  expect(at.a!.position.x).toBeLessThan(at.b!.position.x);
  // The tree is a rack in its parent's layout, at its grown size.
  expect(tree.width).toBeGreaterThanOrEqual(treeInset + 2 * 360 + layoutGap.x);
  expect(at.d!.position.x).toBeGreaterThanOrEqual(
    tree.position.x + tree.width! + layoutGap.x,
  );
});

test("gives an empty tree its default size", async () => {
  const state = build([], [], ["g"]);

  const { nodes } = await layout(state);

  expect(nodes[0]?.width).toBe(treeNodeWidth);
  expect(nodes[0]?.height).toBe(treeNodeHeight);
});

test("keeps racks that aren't cabled from overlapping", async () => {
  const state = build([["a"], ["b"], ["c"], ["d", "g"], ["e", "g"]], [], ["g"]);

  const { nodes } = await layout(state, { b: 400 });
  const siblings = Object.groupBy(nodes, (node) => node.parentId ?? "root");

  for (const group of Object.values(siblings)) {
    for (const [i, a] of (group ?? []).entries()) {
      for (const b of (group ?? []).slice(i + 1)) {
        expect(overlap(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  }
});

test("keeps the nodes in the order it was given", async () => {
  const state = build([["a"], ["b"], ["c"]], ["c>b", "b>a"]);

  const { nodes } = await layout(state);

  expect(nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
});

test("moves the racks without undoing what changed while laying out", async () => {
  const state = build([["a"], ["b"]], ["a>b"]);
  const { nodes } = await layout(state);
  const current = drawn(state).nodes.map((node) =>
    node.id === "a" ? { ...node, selected: true } : node,
  );

  const applied = byIdOf(applyLayout(current, nodes));

  expect(applied.a!.selected).toBe(true);
  expect(applied.b!.position).toEqual(byIdOf(nodes).b!.position);
});
