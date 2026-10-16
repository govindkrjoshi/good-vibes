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
import { useRack } from "../../hooks/useRack";
import { useDispatch } from "../../hooks/useDispatch";
import { canConnectJacks, edits, rackStore } from "../../rack";
import { useSandboxStatus } from "../../hooks/useSandboxStatus";
import { BlockNode } from "./block-node";
import { RackNode } from "../rack/rack-node";
import { useCanvasStore } from "./lock-store";

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
  const dispatch = useDispatch();

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const ids = jackIds(connection);
    return ids !== undefined && canConnectJacks(rackStore.getState(), ...ids);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      const ids = jackIds(connection);
      if (ids !== undefined) dispatch(edits.connectJacks(...ids));
    },
    [dispatch],
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
  const blocks = useRack((state) => state.blocks);
  const jacks = useRack((state) => state.jacks);
  const patches = useRack((state) => state.patches);
  const rootId = useRack((state) => state.rootId);
  const errors = useSandboxStatus((status) => status.errors);

  useEffect(() => {
    // A patch the sandbox could not make is drawn as broken, with why.
    const edges = toFlowEdges(blocks, jacks, patches, rootId).map((edge) => {
      const error = errors[`connect:${edge.id}`];
      return error === undefined
        ? edge
        : {
            ...edge,
            className: "edge-error",
            style: { stroke: "var(--destructive)", strokeDasharray: "4 3" },
            ariaLabel: `Not connected: ${error.message}`,
          };
    });

    setEdges(edges);
    setNodes((current) => {
      const next = syncNodesFromRack(current, blocks, jacks, rootId);
      return sameBlocks(current, next) ? next : layoutNodes(next, edges);
    });
  }, [setNodes, setEdges, blocks, jacks, patches, rootId, errors]);

  return null;
}
