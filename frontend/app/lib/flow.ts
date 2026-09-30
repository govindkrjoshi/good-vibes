import dagre from "@dagrejs/dagre";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { canPatch, type Jack, type Patch, type Rack } from "~/types/rack";

export type BlockNodeData = {
  readonly name: string;
  readonly kind: "node" | "tree";
  /** The block's jacks, resolved from their ids: one handle each. */
  readonly jacks: readonly Jack[];
};

export type BlockNode = Node<BlockNodeData, "block">;

const origin: XYPosition = { x: 0, y: 0 };

/**
 * Brings React Flow's nodes in line with the rack. The rack says what the
 * blocks are; React Flow owns where they sit, how big they measured and
 * whether they are selected, so a node it already holds keeps all of that and
 * only its rack-derived `data` is replaced. A block with no node yet starts at
 * the origin until the canvas lays it out. Only the root's
 * children are on the canvas — a group's own children live inside it, and
 * opening one is its own step.
 */
export const syncNodesFromRack = (
  currentNodes: readonly BlockNode[],
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  rootId: string,
): BlockNode[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  const held = new Map(currentNodes.map((node) => [node.id, node]));

  return root.children.flatMap((id): BlockNode[] => {
    const block = blocks[id];
    if (block === undefined) return [];

    const data: BlockNodeData = {
      name: block.name,
      kind: block.type === "tree" ? "tree" : "node",
      jacks: block.jackIds.flatMap((jackId) => jacks[jackId] ?? []),
    };

    const existing = held.get(id);
    if (existing !== undefined) return [{ ...existing, data }];

    return [{ id: block.id, type: "block", position: origin, data }];
  });
};

/** The size a block renders at: dagre needs one to space blocks apart. */
const nodeWidth = 176;
const nodeHeight = 44;

/**
 * Lays the blocks out left to right along their patches, the way signal flows
 * through them: out of a block's right side and into the next one's left.
 * Blocks with no patches between them stack in a column rather than on top of
 * each other. Everything but each node's position is kept.
 */
export const layoutNodes = (
  nodes: readonly BlockNode[],
  edges: readonly Edge[],
): BlockNode[] => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR" });

  for (const node of nodes) {
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  // Dagre anchors a node at its centre; React Flow at its top-left corner.
  return nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    return {
      ...node,
      position: { x: x - nodeWidth / 2, y: y - nodeHeight / 2 },
    };
  });
};

/** The rack's patches as React Flow edges between block jack handles. */
export const toFlowEdges = (
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  patches: Record<string, Patch>,
  rootId: string,
): Edge[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  return root.patches.flatMap((id) => {
    const patch = patches[id];
    if (patch === undefined) return [];

    const source = jacks[patch.from];
    const target = jacks[patch.to];

    // The store patches by this same rule, so a patch that fails it is one the
    // canvas cannot draw rather than one it would draw the wrong way round.
    if (
      source === undefined ||
      target === undefined ||
      !canPatch(root, source, target)
    ) {
      return [];
    }

    return [
      {
        id: patch.id,
        source: source.belongToBlockId,
        sourceHandle: source.id,
        target: target.belongToBlockId,
        targetHandle: target.id,
      },
    ];
  });
};
