import { Play } from "lucide-react";
import { useEffect } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { CanvasMenu } from "./canvas-menu";
import { HelpButton } from "./help-button";
import { RackToolbar } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { Button } from "./ui/button";
import { useShortcuts } from "../hooks/useShortcuts";
import { useCanvasStore } from "../stores/canvas";
import { loadTone, useRackStore } from "../stores/rack";

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const addBlock = useRackStore((state) => state.addBlock);
  const addCatalogueBlock = useRackStore((state) => state.addCatalogueBlock);
  const removeBlocks = useRackStore((state) => state.removeBlocks);
  const removePatches = useRackStore((state) => state.removePatches);
  const run = useRackStore((state) => state.run);
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes, getEdges } =
    useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const hasSelection = useStore(
    (state) =>
      state.nodes.some((node) => node.selected === true) ||
      state.edges.some((edge) => edge.selected === true),
  );
  const canDelete = !locked && hasSelection;

  // Ready before the first Run, so audio can start inside its click. A load
  // that fails here is tried again by Run.
  useEffect(() => {
    loadTone().catch(() => undefined);
  }, []);

  const addLeaf = () => addBlock("leaf");
  const addGroup = () => addBlock("tree");

  // The rack only models leaves and trees so far, so each typed tool adds the
  // closest of the two until its own block type lands in the store.
  const addSource = addLeaf;
  const addInstrument = () => addCatalogueBlock("instruments", "AMSynth");
  const addEffect = addLeaf;
  const addComponent = addGroup;
  const addSignal = addLeaf;
  const addEvent = addLeaf;
  const addDestination = () => addCatalogueBlock("output", "Destination");

  const deleteSelection = () => {
    if (!canDelete) return;
    removePatches(
      getEdges()
        .filter((edge) => edge.selected === true)
        .map((edge) => edge.id),
    );
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
    d: addDestination,
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
        onAddDestination={addDestination}
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
