import type { Edge, Rect } from "@xyflow/react";
import type { ELK, ElkExtendedEdge, ElkNode, ElkPort } from "elkjs";
import { insideHandleId, jacksHeight } from "./graph";
import {
  rackNodeWidth,
  treeHeaderHeight,
  treeInset,
  treeJackRowHeight,
  treeNodeHeight,
  treeNodeWidth,
  type CanvasNode,
} from "./nodes";

// Lays the racks out along their signal flow with ELK's layered algorithm: a
// rack sits to the right of whatever feeds it, at every level of nesting. Each jack is a port on its rack's edge, inputs on the left and outputs
// on the right, and a tree's jacks are ports its children are cabled to from
// the inside, so ELK sizes each tree around what it holds. Sizes come from
// what React Flow measured, so this runs once the nodes have been drawn.

export const layoutGap = { x: 96, y: 48 } as const;

// What a rack takes up before it is measured.
const unmeasured = { width: rackNodeWidth, height: 160 } as const;

// Stands in for the root, which isn't drawn.
const rootId = "layout:root";

// ELK is large, so it is fetched once the canvas is up rather than with it.
let elk: Promise<ELK> | undefined;
export const loadElk = () =>
  (elk ??= import("elkjs/lib/elk.bundled.js").then(
    ({ default: Elk }) => new Elk(),
  ));

// Each tree is laid out on its own, inside out, so ELK can lay racks that
// aren't cabled together side by side rather than stacking them.
const layered = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.spacing.nodeNode": String(layoutGap.y),
  "elk.layered.spacing.nodeNodeBetweenLayers": String(layoutGap.x),
  // Racks that aren't cabled to each other go in one row, left to right in
  // the order they were added, so a new rack lands right of the last one,
  // ready to be cabled.
  "elk.separateConnectedComponents": "true",
  "elk.aspectRatio": "1000",
  "elk.spacing.componentComponent": String(layoutGap.x),
  "elk.layered.considerModelOrder.components": "MODEL_ORDER",
  // Racks keep the order they were last left in, so a new cable or rack
  // doesn't reshuffle the ones around it.
  "elk.layered.crossingMinimization.semiInteractive": "true",
};

const treeOptions = (top: number) => ({
  ...layered,
  "elk.padding": `[top=${top},left=${treeInset},bottom=${treeInset},right=${treeInset}]`,
  "elk.nodeSize.constraints": "MINIMUM_SIZE",
  "elk.nodeSize.minimum": `(${treeNodeWidth}, ${treeNodeHeight})`,
  "elk.portConstraints": "FIXED_ORDER",
});

// A jack's port, at its row in the jack bay, so ELK keeps them in the order
// they are drawn.
const portsOf = (node: CanvasNode, width: number): ElkPort[] => {
  const rows = { in: 0, out: 0 };
  return node.data.jacks.map((jack) => {
    const row = rows[jack.direction]++;
    const isInput = jack.direction === "in";
    return {
      id: jack.id,
      x: isInput ? 0 : width,
      y: treeHeaderHeight + (row + 0.5) * treeJackRowHeight,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": isInput ? "WEST" : "EAST" },
    };
  });
};

const sizeOf = (node: CanvasNode) => {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  return {
    width: width > 0 ? width : unmeasured.width,
    height: height > 0 ? height : unmeasured.height,
  };
};

// The jack a handle stands for: a tree's inside socket is the same jack.
const jackOf = (handleId: string, nodeId: string) =>
  handleId.startsWith(insideHandleId(""))
    ? { jackId: handleId.slice(insideHandleId("").length), container: nodeId }
    : { jackId: handleId, container: undefined };

export type Arranged = {
  readonly nodes: CanvasNode[];
  // What the racks under the root span, for fitting the view to them.
  readonly bounds: Rect;
};

export const layoutNodes = async (
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
): Promise<Arranged> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const graph: ElkNode = {
    id: rootId,
    layoutOptions: {
      ...layered,
      "elk.padding": "[top=0,left=0,bottom=0,right=0]",
    },
    children: [],
    edges: [],
  };
  const elkNodes = new Map<string, ElkNode>([[rootId, graph]]);

  // Nodes come parents first, so a tree is in the graph before its children.
  for (const node of nodes) {
    const isTree = node.type === "tree";
    const size = isTree ? undefined : sizeOf(node);
    const elkNode: ElkNode = {
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      ...size,
      ports: portsOf(node, size?.width ?? treeNodeWidth),
      // A tree's children sit a gap below its jacks, so the cables leaving
      // its inside sockets downward have room to turn.
      layoutOptions: isTree
        ? treeOptions(jacksHeight(node.data) + layoutGap.y)
        : { "elk.portConstraints": "FIXED_ORDER" },
      ...(isTree && { children: [], edges: [] }),
    };
    elkNodes.set(node.id, elkNode);
    elkNodes.get(node.parentId ?? rootId)?.children?.push(elkNode);
  }

  // A cable belongs to the tree it runs inside: the one holding both racks,
  // or the tree itself when it leaves or reaches one of its jacks from inside.
  for (const edge of edges) {
    if (edge.sourceHandle == null || edge.targetHandle == null) continue;
    const source = jackOf(edge.sourceHandle, edge.source);
    const target = jackOf(edge.targetHandle, edge.target);
    const containerId =
      source.container ??
      target.container ??
      byId.get(edge.source)?.parentId ??
      rootId;
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const elkEdge: ElkExtendedEdge = {
      id: edge.id,
      sources: [source.jackId],
      targets: [target.jackId],
    };
    elkNodes.get(containerId)?.edges?.push(elkEdge);
  }

  const laidOut = await (await loadElk()).layout(graph);

  const placed = new Map<string, CanvasNode>();
  const place = (elkNode: ElkNode) => {
    for (const child of elkNode.children ?? []) {
      const node = byId.get(child.id);
      if (node === undefined) continue;
      const position = { x: child.x ?? 0, y: child.y ?? 0 };
      placed.set(
        node.id,
        node.type === "tree"
          ? { ...node, position, width: child.width, height: child.height }
          : { ...node, position },
      );
      place(child);
    }
  };
  place(laidOut);

  return {
    nodes: nodes.map((node) => placed.get(node.id) ?? node),
    bounds: {
      x: 0,
      y: 0,
      width: laidOut.width ?? 0,
      height: laidOut.height ?? 0,
    },
  };
};

// Puts the racks where a layout placed them, keeping everything else about
// the nodes as they are now, since they may have changed while it ran.
export const applyLayout = (
  current: readonly CanvasNode[],
  arranged: readonly CanvasNode[],
): CanvasNode[] => {
  const byId = new Map(arranged.map((node) => [node.id, node]));
  return current.map((node) => {
    const held = byId.get(node.id);
    if (held === undefined) return node;
    return node.type === "tree"
      ? {
          ...node,
          position: held.position,
          width: held.width,
          height: held.height,
        }
      : { ...node, position: held.position };
  });
};
