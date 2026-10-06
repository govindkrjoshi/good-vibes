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
import { BlockNode, type BlockNodeType } from "./block-node";
import { RackNode, rackNodeWidth, type RackNodeType } from "./rack-node";
import { canPatch, type Jack, type Patch, type Rack } from "../types/rack";
import { useCanvasStore } from "../stores/canvas";
import { useRackStore } from "../stores/rack";
import { useAgentGreeting } from "../hooks/useGoodVibesAgent";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode, rack: RackNode };

export type CanvasNode = BlockNodeType | RackNodeType;

// The first block arrives after the initial fit, so React Flow fits again for
// it. Without a cap it would fit one block by zooming to 200%, which is not a
// canvas anyone asked to zoom.
const fitViewOptions = { maxZoom: 1 };

const noNodes: CanvasNode[] = [];
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

  useAgentGreeting();

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

const sameBlocks = (a: readonly CanvasNode[], b: readonly CanvasNode[]) =>
  a.length === b.length && a.every((node, i) => node.id === b[i]?.id);

const origin: XYPosition = { x: 0, y: 0 };

// A block with anything to set or trigger is drawn as a panel of controls; one
// without is only a box to wire.
const hasControls = (block: Rack) =>
  block.methodIds.length > 0 ||
  block.paramIds.paramIds !== undefined ||
  block.paramIds.groups !== undefined;

export const syncNodesFromRack = (
  currentNodes: readonly CanvasNode[],
  blocks: Record<string, Rack>,
  jacks: Record<string, Jack>,
  rootId: string,
): CanvasNode[] => {
  const root = blocks[rootId];
  if (root === undefined || root.type !== "tree") return [];

  const held = new Map(currentNodes.map((node) => [node.id, node]));

  return root.children.flatMap((id): CanvasNode[] => {
    const block = blocks[id];
    if (block === undefined) return [];

    const blockJacks = block.jackIds.flatMap((jackId) => jacks[jackId] ?? []);
    const base = held.get(id) ?? { id: block.id, position: origin };

    return [
      hasControls(block)
        ? {
            ...base,
            type: "rack",
            data: { blockId: block.id, name: block.name, jacks: blockJacks },
          }
        : {
            ...base,
            type: "block",
            data: { name: block.name, kind: block.type, jacks: blockJacks },
          },
    ];
  });
};

const nodeWidth = 176;
const nodeHeight = 44;
// A rack panel opens with its sections closed; this is roughly that height,
// used until React Flow has measured the real one.
const rackNodeHeight = 420;

const nodeSize = (node: CanvasNode) => ({
  width:
    node.measured?.width ?? (node.type === "rack" ? rackNodeWidth : nodeWidth),
  height:
    node.measured?.height ??
    (node.type === "rack" ? rackNodeHeight : nodeHeight),
});

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
  const { setNodes, setEdges } = useReactFlow<CanvasNode>();
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
