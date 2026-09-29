import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type NodeChange,
} from "@xyflow/react";
import { BlockNode } from "~/components/block-node";
import { CanvasChrome } from "~/components/canvas-chrome";
import {
  toFlowEdges,
  toFlowNodes,
  type BlockNode as BlockNodeType,
} from "~/lib/flow";
import { useCanvasStore } from "~/stores/canvas";
import { useRackStore } from "~/stores/rack";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode };

/** The two jack ids a connection runs between, or `undefined` when React Flow
 * reports one that did not land on a pair of handles. */
const jackIds = (connection: Connection | Edge) =>
  connection.sourceHandle === null ||
  connection.sourceHandle === undefined ||
  connection.targetHandle === null ||
  connection.targetHandle === undefined
    ? undefined
    : ([connection.sourceHandle, connection.targetHandle] as const);

export function meta() {
  return [{ title: "Good Vibes" }];
}

export default function Home() {
  const locked = useCanvasStore((state) => state.locked);
  const positions = useCanvasStore((state) => state.positions);
  const dimensions = useCanvasStore((state) => state.dimensions);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const moveBlock = useCanvasStore((state) => state.moveBlock);
  const resizeBlock = useCanvasStore((state) => state.resizeBlock);
  const selectBlock = useCanvasStore((state) => state.selectBlock);
  const blocks = useRackStore((state) => state.blocks);
  const jacks = useRackStore((state) => state.jacks);
  const patches = useRackStore((state) => state.patches);
  const rootId = useRackStore((state) => state.rootId);
  const connectJacks = useRackStore((state) => state.connectJacks);
  const canConnectJacks = useRackStore((state) => state.canConnectJacks);

  const nodes = useMemo(
    () =>
      toFlowNodes(blocks, jacks, rootId, positions, dimensions, selectedIds),
    [blocks, jacks, rootId, positions, dimensions, selectedIds],
  );
  const edges = useMemo(
    () => toFlowEdges(blocks, jacks, patches, rootId),
    [blocks, jacks, patches, rootId],
  );

  // The stores are the only copy of the canvas, so every change React Flow
  // makes to a node is folded back into them.
  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNodeType>[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined) {
          moveBlock(change.id, change.position);
        }
        if (change.type === "dimensions" && change.dimensions !== undefined) {
          resizeBlock(change.id, change.dimensions);
        }
        if (change.type === "select") selectBlock(change.id, change.selected);
      }
    },
    [moveBlock, resizeBlock, selectBlock],
  );

  // Asked while the user is still dragging, so a connection the rack would
  // refuse is turned down under the cursor instead of vanishing on release.
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
    <ReactFlowProvider>
      <main className="relative h-screen w-screen">
        <ReactFlow
          fitView
          // The first block arrives after the initial fit, so React Flow fits
          // again for it. Without a cap it would fit one block by zooming to
          // 200%, which is not a canvas anyone asked to zoom.
          fitViewOptions={{ maxZoom: 1 }}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          isValidConnection={isValidConnection}
          onConnect={onConnect}
          onNodesChange={onNodesChange}
          nodesDraggable={!locked}
          nodesConnectable={!locked}
          elementsSelectable={!locked}
        >
          <Background variant={BackgroundVariant.Lines} />
        </ReactFlow>

        <CanvasChrome />
      </main>
    </ReactFlowProvider>
  );
}
