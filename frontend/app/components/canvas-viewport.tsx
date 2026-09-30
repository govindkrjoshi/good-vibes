import { useCallback, useEffect } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import { BlockNode } from "./block-node";
import {
  layoutNodes,
  syncNodesFromRack,
  toFlowEdges,
  type BlockNode as BlockNodeType,
} from "../lib/flow";
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

/** The two jack ids a connection runs between, or `undefined` when React Flow
 * reports one that did not land on a pair of handles. */
const jackIds = (connection: Connection | Edge) =>
  connection.sourceHandle === null ||
  connection.sourceHandle === undefined ||
  connection.targetHandle === null ||
  connection.targetHandle === undefined
    ? undefined
    : ([connection.sourceHandle, connection.targetHandle] as const);

/**
 * The canvas: the adapter between the rack store, which says what the blocks
 * and patches are, and React Flow, which owns where blocks sit, their measured
 * size and the selection. It reaches React Flow through its hooks, so it has to
 * render inside a `ReactFlowProvider`.
 */
export function CanvasViewport() {
  const locked = useCanvasStore((state) => state.locked);
  const connectJacks = useRackStore((state) => state.connectJacks);
  const canConnectJacks = useRackStore((state) => state.canConnectJacks);

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

/** Whether two node lists hold the same blocks in the same order. */
const sameBlocks = (a: readonly BlockNodeType[], b: readonly BlockNodeType[]) =>
  a.length === b.length && a.every((node, i) => node.id === b[i]?.id);

/**
 * Pushes the rack into React Flow's own node and edge lists whenever it
 * changes. Nodes are merged rather than replaced, so what React Flow holds for
 * each block — position, measurement, selection — survives the update. When a
 * block comes or goes the canvas is laid out again; any other change leaves
 * every block where it is.
 */
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
