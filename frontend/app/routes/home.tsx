import { ReactFlowProvider } from "@xyflow/react";
import { CanvasChrome } from "../components/canvas-chrome";
import { CanvasViewport } from "../components/canvas-viewport";

export function meta() {
  return [{ title: "Good Vibes" }];
}

export default function Home() {
  return (
    <ReactFlowProvider>
      <main className="relative h-screen w-screen">
        <CanvasViewport />
        <CanvasChrome />
      </main>
    </ReactFlowProvider>
  );
}
