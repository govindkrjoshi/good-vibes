import { useEffect } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { CanvasMenu } from "./menu";
import { HelpButton } from "./help-button";
import { RackToolbar } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useCanvasStore } from "./lock-store";
import { catalogueTemplate } from "../../catalogue";
import { useRack } from "../../hooks/useRack";
import { loadTone } from "../../rack";

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const addBlock = useRack((state) => state.addBlock);
  const addTemplate = useRack((state) => state.addTemplate);
  const removeBlocks = useRack((state) => state.removeBlocks);
  const removePatches = useRack((state) => state.removePatches);
  const run = useRack((state) => state.run);
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
  const addFromCatalogue = (category: string, entry: string) => {
    const template = catalogueTemplate(category, entry);
    if (template !== undefined) addTemplate(template);
  };
  const addInstrument = () => addFromCatalogue("instruments", "AMSynth");
  const addEffect = addLeaf;
  const addComponent = addGroup;
  const addSignal = addLeaf;
  const addEvent = addLeaf;
  const addDestination = () => addFromCatalogue("output", "Destination");

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
