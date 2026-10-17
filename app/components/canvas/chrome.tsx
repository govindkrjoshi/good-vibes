import * as ReactFlow from "@xyflow/react";
import { CanvasMenu } from "./menu";
import { HelpButton } from "./help-button";
import { RackToolbar } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useCanvasStore } from "./lock-store";
import { useStore } from "../../stores";

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const addRack = useStore((state) => state.rack.addRack);
  const addBlock = useStore((state) => state.rack.addBlock);
  const addRackFromCatalogue = useStore(
    (state) => state.rack.addRackFromCatalogue,
  );
  const rootId = useStore((state) => state.rack.rootId);
  const removeBlocks = useStore((state) => state.rack.removeRacks);
  const removePatches = useStore((state) => state.rack.removePatches);
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes, getEdges } =
    ReactFlow.useReactFlow();
  const zoom = ReactFlow.useStore((state) => state.transform[2]);
  const hasSelection = ReactFlow.useStore(
    (state) =>
      state.nodes.some((node) => node.selected === true) ||
      state.edges.some((edge) => edge.selected === true),
  );
  const canDelete = !locked && hasSelection;

  const addLeaf = () => addBlock("leaf", rootId);
  const addGroup = () => addBlock("tree", rootId);

  // The rack only models leaves and trees so far, so each typed tool adds the
  // closest of the two until its own block type lands in the store.
  const addSource = addLeaf;
  const addInstrument = () =>
    addRackFromCatalogue("instruments", "AMSynth", rootId);
  const addEffect = addLeaf;
  const addComponent = addGroup;
  const addSignal = addLeaf;
  const addEvent = addLeaf;
  const addDestination = () =>
    addRackFromCatalogue("output", "Destination", rootId);

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
  });

  return (
    <>
      <CanvasMenu onFitView={() => fitView()} onResetZoom={() => zoomTo(1)} />

      {/* Drops below the menu island wherever the two would meet. */}
      <RackToolbar
        className="@max-2xl/canvas:top-18"
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
