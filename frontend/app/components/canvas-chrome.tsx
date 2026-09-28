import { Play } from "lucide-react";
import { useReactFlow, useStore } from "@xyflow/react";
import { CanvasMenu } from "~/components/canvas-menu";
import { HelpButton } from "~/components/help-button";
import { RackToolbar } from "~/components/rack-toolbar";
import { ViewportControls } from "~/components/viewport-controls";
import { Button } from "~/components/ui/button";
import { useShortcuts } from "~/hooks/useShortcuts";
import { useCanvasStore } from "~/stores/canvas";
import { useRackStore } from "~/stores/rack";

/**
 * Every floating control that sits over the canvas. It reads the viewport
 * through React Flow, so it has to render inside the provider.
 */
export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const addBlock = useRackStore((state) => state.addBlock);
  const run = useRackStore((state) => state.run);
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);

  const addNode = () => addBlock("node");
  const addGroup = () => addBlock("tree");

  useShortcuts({ n: addNode, g: addGroup, r: run });

  return (
    <>
      <CanvasMenu
        onFitView={() => fitView()}
        onResetZoom={() => zoomTo(1)}
        onRun={run}
      />

      <RackToolbar
        locked={locked}
        onToggleLock={toggleLock}
        onAddNode={addNode}
        onAddGroup={addGroup}
      />

      <Button
        size="lg"
        data-testid="run-rack"
        className="absolute top-4 right-4 z-10 h-11 rounded-xl px-4 shadow-md"
        onClick={run}
      >
        <Play />
        Run
      </Button>

      <ViewportControls
        zoom={zoom}
        onZoomIn={() => zoomIn()}
        onZoomOut={() => zoomOut()}
        onResetZoom={() => zoomTo(1)}
      />

      <HelpButton />
    </>
  );
}
