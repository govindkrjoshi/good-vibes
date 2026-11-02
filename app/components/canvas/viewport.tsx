import { useCallback, useEffect, type MouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
} from "@xyflow/react";
import {
  fitTrees,
  jackIds,
  syncNodesFromRack,
  toFlowEdges,
  treeAt,
  type CanvasNode,
} from "../../canvas";
import { isInside } from "../../rack";
import { BlockNode } from "./block-node";
import { TreeNode } from "./tree-node";
import { RackNode } from "../rack/rack-node";
import { useCanvasStore } from "./lock-store";
import { useStore } from "../../stores";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode, rack: RackNode, tree: TreeNode };

// The first block arrives after the initial fit, so React Flow fits again for
// it. Without a cap it would fit one block by zooming to 200%, which is not a
// canvas anyone asked to zoom.
const fitViewOptions = { maxZoom: 1 };

const noNodes: CanvasNode[] = [];
const noEdges: Edge[] = [];

type DragEvent = MouseEvent | globalThis.MouseEvent | TouchEvent;

const pointerOf = (event: DragEvent) =>
  "changedTouches" in event ? event.changedTouches[0] : event;

// Moves racks in and out of trees as they are dragged. The pointer decides
// where they land, since a rack panel can be as wide as the tree it is going
// into. Dragging a tree with a rack inside it only moves the tree.
function useRackDrop() {
  const { getNodes, setNodes, screenToFlowPosition } =
    useReactFlow<CanvasNode>();
  const setDropTarget = useCanvasStore((state) => state.setDropTarget);
  const moveRack = useStore((state) => state.rack.moveRack);

  const targetOf = useCallback(
    (event: DragEvent, dragged: readonly CanvasNode[]) => {
      const pointer = pointerOf(event);
      if (pointer === undefined) return undefined;
      return treeAt(
        getNodes(),
        screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }),
        useStore.getState().rack.racks,
        dragged.map((node) => node.id),
      );
    },
    [getNodes, screenToFlowPosition],
  );

  const onDrag = useCallback(
    (event: DragEvent, dragged: readonly CanvasNode[]) =>
      setDropTarget(targetOf(event, dragged)),
    [setDropTarget, targetOf],
  );

  const onDragStop = useCallback(
    (event: DragEvent, dragged: readonly CanvasNode[]) => {
      setDropTarget(undefined);
      const { racks, rootId } = useStore.getState().rack;
      const parentId = targetOf(event, dragged) ?? rootId;
      const moving = dragged.filter(
        ({ id }) =>
          racks[id]?.parentId !== parentId &&
          !dragged.some((other) => isInside(racks, id, other.id)),
      );

      for (const { id } of moving) moveRack(id, parentId);
      // A move syncs from the store, which fits the trees. A rack that stayed
      // in its tree changes nothing there, so its tree is fitted here.
      if (moving.length === 0) setNodes(fitTrees);
    },
    [moveRack, setDropTarget, setNodes, targetOf],
  );

  return { onDrag, onDragStop };
}

export function CanvasViewport() {
  const locked = useCanvasStore((state) => state.locked);
  const connectJacks = useStore((state) => state.rack.connectJacks);
  const canConnectJacks = useStore((state) => state.rack.canConnectJacks);
  const { onDrag, onDragStop } = useRackDrop();

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
      onNodeDrag={(event, _node, dragged) => onDrag(event, dragged)}
      onNodeDragStop={(event, _node, dragged) => onDragStop(event, dragged)}
      onSelectionDrag={onDrag}
      onSelectionDragStop={onDragStop}
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
    setEdges(toFlowEdges(racks, jacks, patches, rootId));
    setNodes((current) =>
      syncNodesFromRack(current, racks, jacks, paramGroups, rootId),
    );
  }, [setNodes, setEdges, racks, jacks, paramGroups, patches, rootId]);

  return null;
}
