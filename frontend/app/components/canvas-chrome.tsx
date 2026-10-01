import { Play, Square } from "lucide-react";
import { useEffect } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { CanvasMenu } from "./canvas-menu";
import { HelpButton } from "./help-button";
import { NumberField } from "./param-control";
import { RackToolbar } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { Button } from "./ui/button";
import { Island } from "./ui/island";
import { Label } from "./ui/label";
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
  const stop = useRackStore((state) => state.stop);
  const bpm = useRackStore((state) => state.transport.bpm);
  const setTransport = useRackStore((state) => state.setTransport);
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

      {/* Drops below the centred tool island wherever the two would overlap. */}
      <div className="absolute top-20 right-4 z-10 flex items-center gap-2 min-[1080px]:top-4">
        <Island className="flex h-11 items-center gap-2 pr-1 pl-3">
          <Label htmlFor="transport-bpm">BPM</Label>
          <div className="w-14">
            <NumberField
              id="transport-bpm"
              value={bpm}
              min={1}
              step={1}
              onCommit={(next) => setTransport({ bpm: next })}
            />
          </div>
        </Island>
        <Button
          size="lg"
          data-testid="run-rack"
          className="h-11 rounded-xl px-4 shadow-md"
          onClick={run}
        >
          <Play />
          Run
        </Button>
        <Button
          size="lg"
          variant="outline"
          data-testid="stop-rack"
          className="h-11 rounded-xl px-4 shadow-md"
          onClick={stop}
        >
          <Square />
          Stop
        </Button>
      </div>

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
