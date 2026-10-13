import type { Edge } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import {
  blockNodeHeight,
  blockNodeWidth,
  rackNodeHeight,
  rackNodeWidth,
  type CanvasNode,
} from "./nodes";

const nodeSize = (node: CanvasNode) => ({
  width:
    node.measured?.width ??
    (node.type === "rack" ? rackNodeWidth : blockNodeWidth),
  height:
    node.measured?.height ??
    (node.type === "rack" ? rackNodeHeight : blockNodeHeight),
});

// Lays the graph out left to right, each node centred on the spot dagre
// gives it.
export const layoutNodes = (
  nodes: readonly CanvasNode[],
  edges: readonly Edge[],
): CanvasNode[] => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR" });

  for (const node of nodes) {
    graph.setNode(node.id, nodeSize(node));
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    const { width, height } = nodeSize(node);
    return { ...node, position: { x: x - width / 2, y: y - height / 2 } };
  });
};
