import { useReactFlow, useStore } from "@xyflow/react";
import { CanvasMenu } from "./menu";
import { HelpButton } from "./help-button";
import { RackToolbar } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useCanvasStore } from "./lock-store";
import { catalogueTemplate } from "../../catalogue";
import { useDispatch } from "../../hooks/useDispatch";
import { edits, type RackTemplate } from "../../rack";

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const dispatch = useDispatch();
  const addBlock = (blockType: "leaf" | "tree") =>
    dispatch(edits.addBlock(blockType));
  const addTemplate = (template: RackTemplate) =>
    dispatch(edits.addTemplate(template));
  const removeBlocks = (blockIds: readonly string[]) =>
    dispatch(edits.removeBlocks(blockIds));
  const removePatches = (patchIds: readonly string[]) =>
    dispatch(edits.removePatches(patchIds));
  const run = () => dispatch(edits.run());
  const { zoomIn, zoomOut, zoomTo, fitView, getNodes, getEdges } =
    useReactFlow();
  const zoom = useStore((state) => state.transform[2]);
  const hasSelection = useStore(
    (state) =>
      state.nodes.some((node) => node.selected === true) ||
      state.edges.some((edge) => edge.selected === true),
  );
  const canDelete = !locked && hasSelection;

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
