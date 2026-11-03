import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import { CanvasMenu } from "./menu";
import { HelpButton } from "./help-button";
import { RackToolbar } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useCanvasStore } from "./canvas-store";
import { useStore } from "../../stores";
import { newTree } from "../../rack";

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const addRackFromCatalogue = useStore(
    (state) => state.rack.addRackFromCatalogue,
  );
  const addRack = useStore((state) => state.rack.addRack);
  const rootId = useStore((state) => state.rack.rootId);
  const removeRacks = useStore((state) => state.rack.removeRacks);
  const removePatches = useStore((state) => state.rack.removePatches);
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes, getEdges } =
    useReactFlow();
  const zoom = useFlowStore((state) => state.transform[2]);
  const hasSelection = useFlowStore(
    (state) =>
      state.nodes.some((node) => node.selected === true) ||
      state.edges.some((edge) => edge.selected === true),
  );
  const canDelete = !locked && hasSelection;

  const addTree = () => addRack(newTree(crypto.randomUUID(), rootId), rootId);

  // Sources, effects, signals and events have no block type in the store yet,
  // so their tools add nothing until one lands.
  const noBlockYet = () => {};
  const addSource = noBlockYet;
  const addInstrument = () =>
    addRackFromCatalogue("instruments", "AMSynth", rootId);
  const addEffect = noBlockYet;
  const addComponent = addTree;
  const addSignal = noBlockYet;
  const addEvent = noBlockYet;
  const addDestination = () =>
    addRackFromCatalogue("output", "Destination", rootId);

  const resetZoom = () => zoomTo(1);

  const deleteSelection = () => {
    if (!canDelete) return;
    removePatches(
      getEdges()
        .filter((edge) => edge.selected === true)
        .map((edge) => edge.id),
    );
    removeRacks(
      getNodes()
        .filter((node) => node.selected === true)
        .map((node) => node.id),
    );
  };

  useShortcuts({
    g: addTree,
    s: addSource,
    i: addInstrument,
    e: addEffect,
    c: addComponent,
    l: addSignal,
    v: addEvent,
    d: addDestination,
    backspace: deleteSelection,
    delete: deleteSelection,
  });

  return (
    <>
      <CanvasMenu onFitView={() => fitView()} onResetZoom={resetZoom} />

      {/* Drops below the menu island wherever the two would meet. */}
      <RackToolbar
        className="@max-2xl/canvas:top-18"
        locked={locked}
        onToggleLock={toggleLock}
        onAddGroup={addTree}
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

      <ViewportControls
        zoom={zoom}
        onZoomIn={() => zoomIn()}
        onZoomOut={() => zoomOut()}
        onResetZoom={resetZoom}
      />

      <HelpButton />
    </>
  );
}
