import type { Rect, XYPosition } from "@xyflow/react";
import type { Jack, Patch, Rack } from "../rack";
import { jacksHeight } from "./graph";
import {
  rackNodeWidth,
  treeInset,
  treeNodeHeight,
  treeNodeWidth,
  type CanvasNode,
} from "./nodes";

// Lays every rack out along its signal flow: a rack sits one column to the
// right of whatever feeds it, and racks in a column are stacked, each column
// centred on the tallest in its row. A tree's children are laid out inside it
// the same way and the tree grows to hold them, so the canvas reads left to
// right at every level. Sizes come from what React Flow measured, so this
// runs once the nodes have been drawn.

export const layoutGap = { x: 96, y: 48 } as const;

// A chain longer than this goes on in a row below, so a tree stays about as
// wide as a screen rather than a long strip.
export const layoutColumns = 6;

// What a rack takes up before it is measured.
const unmeasured = { width: rackNodeWidth, height: 160 } as const;

type Size = { readonly width: number; readonly height: number };

export type Arranged = {
  readonly nodes: CanvasNode[];
  // What the racks under the root span, for fitting the view to them.
  readonly bounds: Rect;
};

// Each rack's column: a rack with nothing feeding it is in the first, and
// every other is one past the furthest of the racks feeding it. A cable that
// closes a loop doesn't count, or there would be no first column.
const columnsOf = (
  children: readonly CanvasNode[],
  feeds: ReadonlyMap<string, readonly string[]>,
): CanvasNode[][] => {
  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const columnOf = (id: string): number => {
    const held = column.get(id);
    if (held !== undefined) return held;
    if (visiting.has(id)) return -1;
    visiting.add(id);
    let depth = 0;
    for (const feed of feeds.get(id) ?? []) {
      depth = Math.max(depth, columnOf(feed) + 1);
    }
    visiting.delete(id);
    column.set(id, depth);
    return depth;
  };

  const columns: CanvasNode[][] = [];
  for (const child of children) {
    (columns[columnOf(child.id)] ??= []).push(child);
  }

  // A rack sits level with what feeds it, as far as its column allows.
  const row = new Map<string, number>();
  for (const held of columns) {
    const keyed = held.map((node, index) => {
      const rows = (feeds.get(node.id) ?? []).flatMap(
        (id) => row.get(id) ?? [],
      );
      const key =
        rows.length === 0
          ? index
          : rows.reduce((sum, held) => sum + held, 0) / rows.length;
      return { node, key, index };
    });
    keyed.sort((a, b) => a.key - b.key || a.index - b.index);
    held.splice(0, held.length, ...keyed.map(({ node }) => node));
    held.forEach((node, index) => row.set(node.id, index));
  }
  return columns.filter((held) => held !== undefined);
};

export const arrange = (
  nodes: readonly CanvasNode[],
  racks: Readonly<Record<string, Rack>>,
  jacks: Readonly<Record<string, Jack>>,
  patches: Readonly<Record<string, Patch>>,
  rootId: string,
): Arranged => {
  const placed = new Map(nodes.map((node) => [node.id, node]));
  // A tree's size once its children are laid out, which its parent lays out by.
  const grown = new Map<string, Size>();

  const sizeOf = (node: CanvasNode): Size => {
    const held = grown.get(node.id);
    if (held !== undefined) return held;
    const width = node.measured?.width ?? node.width ?? 0;
    const height = node.measured?.height ?? node.height ?? 0;
    return {
      width: width > 0 ? width : unmeasured.width,
      height: height > 0 ? height : unmeasured.height,
    };
  };

  // Lays a tree's children out from `origin`, in its coordinates, and says
  // how much room they take.
  const layoutChildren = (treeId: string, origin: XYPosition): Size => {
    const tree = racks[treeId];
    const children = nodes.filter(
      (node) => (node.parentId ?? rootId) === treeId,
    );
    if (tree?.type !== "tree" || children.length === 0) {
      return { width: 0, height: 0 };
    }

    const ids = new Set(children.map((child) => child.id));
    const feeds = new Map<string, string[]>(
      children.map((child) => [child.id, []]),
    );
    for (const id of tree.patches) {
      const patch = patches[id];
      const from = patch && jacks[patch.from];
      const to = patch && jacks[patch.to];
      if (from === undefined || to === undefined) continue;
      const source = from.belongToBlockId;
      const target = to.belongToBlockId;
      if (source !== target && ids.has(source) && ids.has(target)) {
        feeds.get(target)!.push(source);
      }
    }

    const columns = columnsOf(children, feeds);
    const rows: CanvasNode[][][] = [];
    columns.forEach((column, index) => {
      (rows[Math.floor(index / layoutColumns)] ??= []).push(column);
    });

    let widest = 0;
    let y = origin.y;
    for (const row of rows) {
      const heights = row.map(
        (column) =>
          column.reduce((sum, node) => sum + sizeOf(node).height, 0) +
          layoutGap.y * (column.length - 1),
      );
      const tallest = Math.max(...heights);
      let x = origin.x;
      row.forEach((column, index) => {
        const width = Math.max(...column.map((node) => sizeOf(node).width));
        let top = y + (tallest - heights[index]!) / 2;
        for (const node of column) {
          placed.set(node.id, {
            ...placed.get(node.id)!,
            position: { x, y: top },
          });
          top += sizeOf(node).height + layoutGap.y;
        }
        x += width + layoutGap.x;
      });
      widest = Math.max(widest, x - layoutGap.x - origin.x);
      y += tallest + layoutGap.y;
    }
    return { width: widest, height: y - layoutGap.y - origin.y };
  };

  // Nodes come parents first, so going backwards lays out a nested tree, and
  // sizes it, before the tree holding it.
  for (const node of nodes.toReversed()) {
    if (node.type !== "tree") continue;
    const top = jacksHeight(node.data);
    const inner = layoutChildren(node.id, { x: treeInset, y: top });
    const size = {
      width: Math.max(treeNodeWidth, treeInset + inner.width + treeInset),
      height: Math.max(treeNodeHeight, top + inner.height + treeInset),
    };
    grown.set(node.id, size);
    placed.set(node.id, { ...placed.get(node.id)!, ...size });
  }
  const span = layoutChildren(rootId, { x: 0, y: 0 });

  return {
    nodes: nodes.map((node) => placed.get(node.id)!),
    bounds: { x: 0, y: 0, width: span.width, height: span.height },
  };
};
