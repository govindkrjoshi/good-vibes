import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type Edge,
  type ReactFlowState,
} from "@xyflow/react";
import {
  applyLayout,
  fitTrees,
  layoutNodes,
  loadElk,
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
import { useCanvasStore } from "./canvas-store";
import { useStore } from "../../stores";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode, rack: RackNode, tree: TreeNode };

// The first block arrives after the initial fit, so React Flow fits again for
// it. Without a cap it would fit one block by zooming to 200%, which is not a
// canvas anyone asked to zoom.
const fitViewOptions = { maxZoom: 1 };

// A hundred racks laid out don't fit at React Flow's usual floor of 50%.
const minZoom = 0.05;

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

  const targetOf = (event: DragEvent, dragged: readonly CanvasNode[]) => {
    const pointer = pointerOf(event);
    if (pointer === undefined) return undefined;
    return treeAt(
      getNodes(),
      screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY }),
      useStore.getState().rack.racks,
      dragged.map((node) => node.id),
    );
  };

  const onDrag = (event: DragEvent, dragged: readonly CanvasNode[]) =>
    setDropTarget(targetOf(event, dragged));

  const onDragStop = (event: DragEvent, dragged: readonly CanvasNode[]) => {
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
  };

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
      minZoom={minZoom}
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
      <AutoLayout />
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

  // The edges are rebuilt, and a selected one has to stay selected to be
  // deleted.
  useEffect(() => {
    setEdges((current) => {
      const selected = new Set(
        current.filter((edge) => edge.selected === true).map((edge) => edge.id),
      );
      return toFlowEdges(racks, jacks, patches, rootId).map((edge) =>
        selected.has(edge.id) ? { ...edge, selected: true } : edge,
      );
    });
  }, [setEdges, racks, jacks, patches, rootId]);

  useEffect(() => {
    setNodes((current) =>
      syncNodesFromRack(current, racks, jacks, paramGroups, rootId),
    );
  }, [setNodes, racks, jacks, paramGroups, rootId]);

  return null;
}

// Which racks there are, where they sit and how they are cabled, as one string
// to compare. Nothing else about them moves them.
const shapeOf = ({ nodes, edges }: ReactFlowState) =>
  [
    ...nodes.map((node) => `${node.id}<${node.parentId ?? ""}`).sort(),
    "|",
    ...edges.map((edge) => `${edge.sourceHandle}>${edge.targetHandle}`).sort(),
  ].join(",");

const nodeSetOf = ({ nodes }: ReactFlowState) =>
  nodes
    .map((node) => node.id)
    .sort()
    .join(",");

// Lays the racks out along their signal flow whenever which racks there are,
// or how they are cabled, changes, once React Flow has measured them all. The
// view is fitted to them when racks come or go, but not for a new cable.
function AutoLayout() {
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow<CanvasNode>();
  const initialized = useNodesInitialized();
  const shape = useFlowStore(shapeOf);
  const nodeSet = useFlowStore(nodeSetOf);
  const laidOut = useRef<string | undefined>(undefined);
  const fitted = useRef<string | undefined>(undefined);

  useEffect(() => void loadElk(), []);

  useEffect(() => {
    if (!initialized || shape === laidOut.current) return;
    // A layout that finishes after the racks changed again is out of date.
    let stale = false;
    void layoutNodes(getNodes(), getEdges()).then(({ nodes }) => {
      if (stale) return;
      laidOut.current = shape;
      setNodes((current) => applyLayout(current, nodes));
      if (nodeSet !== fitted.current) {
        fitted.current = nodeSet;
        void fitView({ ...fitViewOptions, padding: 0.1, duration: 300 });
      }
    });
    return () => {
      stale = true;
    };
  }, [initialized, shape, nodeSet, getNodes, getEdges, setNodes, fitView]);

  return null;
}
