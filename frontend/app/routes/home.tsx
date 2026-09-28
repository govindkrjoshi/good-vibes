import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { CanvasChrome } from "~/components/canvas-chrome";
import { useCanvasStore } from "~/stores/canvas";

export function meta() {
  return [{ title: "Good Vibes" }];
}

export default function Home() {
  const locked = useCanvasStore((state) => state.locked);

  return (
    <ReactFlowProvider>
      <main className="relative h-screen w-screen">
        <ReactFlow
          fitView
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
