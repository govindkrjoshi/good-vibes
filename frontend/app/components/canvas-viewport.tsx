import { useCallback, useEffect } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type XYPosition,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import {
  BlockNode,
  type BlockNodeData,
  type BlockNodeType,
} from "./block-node";
import { canPatch, type Jack, type Patch, type Rack } from "../types/rack";
import { useCanvasStore } from "../stores/canvas";
import { useRackStore } from "../stores/rack";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode };

// The first block arrives after the initial fit, so React Flow fits again for
// it. Without a cap it would fit one block by zooming to 200%, which is not a
// canvas anyone asked to zoom.
const fitViewOptions = { maxZoom: 1 };

const noNodes: BlockNodeType[] = [];
const noEdges: Edge[] = [];

const jackIds = (connection: Connection | Edge) =>
  connection.sourceHandle === null ||
  connection.sourceHandle === undefined ||
  connection.targetHandle === null ||
  connection.targetHandle === undefined
    ? undefined
    : ([connection.sourceHandle, connection.targetHandle] as const);

export function CanvasViewport() {
  const locked = useCanvasStore((state) => state.locked);
  const connectJacks = useRackStore((state) => state.connectJacks);
  const canConnectJacks = useRackStore((state) => state.canConnectJacks);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const ids = jackIds(connection);
      return ids !== undefined && canConnectJacks(...ids);
    },
    [canConnectJacks],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const ids = jackIds(connection);
      if (ids !== undefined) connectJacks(...ids);
    },
    [connectJacks],
  );

  return (
    <ReactFlow
      fitView
      fitViewOptions={fitViewOptions}
      defaultNodes={noNodes}
      defaultEdges={noEdges}
      nodeTypes={nodeTypes}
      isValidConnection={isValidConnection}
      onConnect={onConnect}
      // Deleting goes through the rack store, from the toolbar and the
      // Backspace shortcut. React Flow's own delete key would only drop the
      // nodes from the canvas, and the next sync would put them back.
      deleteKeyCode={null}
      nodesDraggable={!locked}
      nodesConnectable={!locked}
      elementsSelectable={!locked}
    >
      <RackReactFlowSync />
      <Background variant={BackgroundVariant.Lines} />
    </ReactFlow>
  );
}

const sameBlocks = (a: readonly BlockNodeType[], b: readonly BlockNodeType[]) =>
  a.length === b.length && a.every((node, i) => node.id === b[i]?.id);

const origin: XYPosition = { x: 0, y: 0 };

export const syncNodesFromRack = (
  currentNodes: readonly BlockNodeType[],
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  rootId: string,
): BlockNodeType[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  const held = new Map(currentNodes.map((node) => [node.id, node]));

  return root.children.flatMap((id): BlockNodeType[] => {
    const block = blocks[id];
    if (block === undefined) return [];

    const data: BlockNodeData = {
      name: block.name,
      kind: block.type,
      jacks: block.jackIds.flatMap((jackId) => jacks[jackId] ?? []),
    };

    const existing = held.get(id);
    if (existing !== undefined) return [{ ...existing, data }];

    return [{ id: block.id, type: "block", position: origin, data }];
  });
};

const nodeWidth = 176;
const nodeHeight = 44;

export const layoutNodes = (
  nodes: readonly BlockNodeType[],
  edges: readonly Edge[],
): BlockNodeType[] => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR" });

  for (const node of nodes) {
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);

  dagre.layout(graph);

  return nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    return {
      ...node,
      position: { x: x - nodeWidth / 2, y: y - nodeHeight / 2 },
    };
  });
};

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

function RackReactFlowSync() {
  const { setNodes, setEdges } = useReactFlow<BlockNodeType>();
  const blocks = useRackStore((state) => state.blocks);
  const jacks = useRackStore((state) => state.jacks);
  const patches = useRackStore((state) => state.patches);
  const rootId = useRackStore((state) => state.rootId);

  useEffect(() => {
    const edges = toFlowEdges(blocks, jacks, patches, rootId);

    setEdges(edges);
    setNodes((current) => {
      const next = syncNodesFromRack(current, blocks, jacks, rootId);
      return sameBlocks(current, next) ? next : layoutNodes(next, edges);
    });
  }, [setNodes, setEdges, blocks, jacks, patches, rootId]);

  return null;
}
