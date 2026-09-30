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
  const removeBlocks = useRackStore((state) => state.removeBlocks);
  const run = useRackStore((state) => state.run);
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes } = useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const hasSelection = useStore((state) =>
    state.nodes.some((node) => node.selected === true),
  );
  const canDelete = !locked && hasSelection;

  const addNode = () => addBlock("node");
  const addGroup = () => addBlock("tree");

  // The rack only models nodes and trees so far, so each typed tool adds the
  // closest of the two until its own block type lands in the store.
  const addSource = addNode;
  const addInstrument = addNode;
  const addEffect = addNode;
  const addComponent = addGroup;
  const addSignal = addNode;
  const addEvent = addNode;

  // Node ids are block ids, so the selection names the blocks to remove. The
  // canvas drops their nodes once the rack no longer holds them.
  const deleteSelection = () => {
    if (!canDelete) return;
    removeBlocks(
      getNodes()
        .filter((node) => node.selected === true)
        .map((node) => node.id),
    );
  };

  useShortcuts({
    g: addGroup,
    s: addSource,
    i: addInstrument,
    e: addEffect,
    c: addComponent,
    l: addSignal,
    v: addEvent,
    backspace: deleteSelection,
    delete: deleteSelection,
    r: run,
  });

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
        onAddGroup={addGroup}
        onAddSource={addSource}
        onAddInstrument={addInstrument}
        onAddEffect={addEffect}
        onAddComponent={addComponent}
        onAddSignal={addSignal}
        onAddEvent={addEvent}
        canDelete={canDelete}
        onDelete={deleteSelection}
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
