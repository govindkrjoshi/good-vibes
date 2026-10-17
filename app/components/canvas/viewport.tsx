import { useCallback, useEffect } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import {
  jackIds,
  layoutNodes,
  sameBlocks,
  syncNodesFromRack,
  toFlowEdges,
  type CanvasNode,
} from "../../canvas";
import { BlockNode } from "./block-node";
import { RackNode } from "../rack/rack-node";
import { useCanvasStore } from "./lock-store";
import { useStore } from "../../stores";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode, rack: RackNode };

// The first block arrives after the initial fit, so React Flow fits again for
// it. Without a cap it would fit one block by zooming to 200%, which is not a
// canvas anyone asked to zoom.
const fitViewOptions = { maxZoom: 1 };

const noNodes: CanvasNode[] = [];
const noEdges: Edge[] = [];

export function CanvasViewport() {
  const locked = useCanvasStore((state) => state.locked);
  const connectJacks = useStore((state) => state.rack.connectJacks);
  const canConnectJacks = useStore((state) => state.rack.canConnectJacks);

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

function RackReactFlowSync() {
  const { setNodes, setEdges } = useReactFlow<CanvasNode>();
  const racks = useStore((state) => state.rack.racks);
  const jacks = useStore((state) => state.rack.jacks);
  const paramGroups = useStore((state) => state.rack.paramGroups);
  const patches = useStore((state) => state.rack.patches);
  const rootId = useStore((state) => state.rack.rootId);

  useEffect(() => {
    const edges = toFlowEdges(racks, jacks, patches, rootId);

    setEdges(edges);
    setNodes((current) => {
      const next = syncNodesFromRack(
        current,
        racks,
        jacks,
        paramGroups,
        rootId,
      );
      return sameBlocks(current, next) ? next : layoutNodes(next, edges);
    });
  }, [setNodes, setEdges, racks, jacks, paramGroups, patches, rootId]);

  return null;
}
