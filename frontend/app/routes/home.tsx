import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import { useState } from "react";
import { CanvasChrome } from "~/components/canvas-chrome";

export function meta() {
  return [{ title: "Good Vibes" }];
}

export default function Home() {
  const [locked, setLocked] = useState(false);

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

        <CanvasChrome
          locked={locked}
          onToggleLock={() => setLocked((current) => !current)}
        />
      </main>
    </ReactFlowProvider>
  );
}
