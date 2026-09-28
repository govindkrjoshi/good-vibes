import { Play } from "lucide-react";
import { useReactFlow, useStore } from "@xyflow/react";
import { CanvasMenu } from "~/components/canvas-menu";
import { HelpButton } from "~/components/help-button";
import { RackToolbar } from "~/components/rack-toolbar";
import { ViewportControls } from "~/components/viewport-controls";
import { Button } from "~/components/ui/button";
import { useRack } from "~/hooks/useRack";
import { useShortcuts } from "~/hooks/useShortcuts";

type CanvasChromeProps = {
  readonly locked: boolean;
  readonly onToggleLock: () => void;
};

/**
 * Every floating control that sits over the canvas. It reads the viewport
 * through React Flow, so it has to render inside the provider.
 */
export function CanvasChrome({ locked, onToggleLock }: CanvasChromeProps) {
  const { dispatch } = useRack();
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);

  const addNode = () => dispatch({ type: "addBlock", blockType: "node" });
  const addGroup = () => dispatch({ type: "addBlock", blockType: "tree" });
  const run = () => dispatch({ type: "run" });

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
        onToggleLock={onToggleLock}
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
