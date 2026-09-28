import { useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  type NodeChange,
} from "@xyflow/react";
import { BlockNode } from "~/components/block-node";
import { CanvasChrome } from "~/components/canvas-chrome";
import { toFlowNodes, type BlockNode as BlockNodeType } from "~/lib/flow";
import { useCanvasStore } from "~/stores/canvas";
import { useRackStore } from "~/stores/rack";

// React Flow re-registers every node type when this object changes identity,
// so it has to be built once, outside the component.
const nodeTypes = { block: BlockNode };

export function meta() {
  return [{ title: "Good Vibes" }];
}

export default function Home() {
  const locked = useCanvasStore((state) => state.locked);
  const positions = useCanvasStore((state) => state.positions);
  const selectedIds = useCanvasStore((state) => state.selectedIds);
  const moveBlock = useCanvasStore((state) => state.moveBlock);
  const selectBlock = useCanvasStore((state) => state.selectBlock);
  const blocks = useRackStore((state) => state.blocks);
  const jacks = useRackStore((state) => state.jacks);
  const rootId = useRackStore((state) => state.rootId);

  const nodes = useMemo(
    () => toFlowNodes(blocks, jacks, rootId, positions, selectedIds),
    [blocks, jacks, rootId, positions, selectedIds],
  );

  // The stores are the only copy of the canvas, so every change React Flow
  // makes to a node is folded back into them.
  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNodeType>[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position !== undefined) {
          moveBlock(change.id, change.position);
        }
        if (change.type === "select") selectBlock(change.id, change.selected);
      }
    },
    [moveBlock, selectBlock],
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
          nodeTypes={nodeTypes}
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
