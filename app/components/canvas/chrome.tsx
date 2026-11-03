import { useMemo, useState } from "react";
import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import { CanvasMenu } from "./menu";
import { HelpButton } from "./help-button";
import { RackToolbar, type CatalogueSection } from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useCanvasStore } from "./canvas-store";
import { useStore } from "../../stores";
import { newTree } from "../../rack";
import { categories, itemsIn, type Category } from "../../catalogue";

const categoryLabels: Record<Category, string> = {
  sources: "Sources",
  instruments: "Instruments",
  effects: "Effects",
  components: "Components",
  signals: "Signals",
  outputs: "Outputs",
};

// What each category's button adds until another item is picked from the
// catalogue menu; a category's first item when its usual one isn't loaded.
const usualItems: Record<Category, string> = {
  sources: "tone/Oscillator",
  instruments: "tone/AMSynth",
  effects: "tone/FeedbackDelay",
  components: "tone/Filter",
  signals: "tone/LFO",
  outputs: "tone/Destination",
};

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const addRackFromCatalogue = useStore(
    (state) => state.rack.addRackFromCatalogue,
  );
  const addRack = useStore((state) => state.rack.addRack);
  const rootId = useStore((state) => state.rack.rootId);
  const registry = useStore((state) => state.catalogue.registry);
  const [picked, setPicked] = useState<Partial<Record<Category, string>>>({});
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

  const catalogue = useMemo(
    (): CatalogueSection[] =>
      categories.map((category) => {
        const items = itemsIn(registry, category);
        const plugins = [...new Set(items.map((item) => item.plugin))];
        return {
          category,
          label: categoryLabels[category],
          plugins: plugins.map((plugin) => ({
            name: registry.plugins[plugin]?.name ?? plugin,
            items: items
              .filter((item) => item.plugin === plugin)
              .map((item) => ({ key: item.key, name: item.name })),
          })),
        };
      }),
    [registry],
  );

  const add = (category: Category) => () => {
    const key =
      [picked[category], usualItems[category]].find(
        (held) => held !== undefined && registry.items[held] !== undefined,
      ) ?? itemsIn(registry, category)[0]?.key;
    if (key !== undefined) addRackFromCatalogue(key, rootId);
  };

  const pick = (itemKey: string) => {
    const item = registry.items[itemKey];
    if (item === undefined) return;
    setPicked((held) => ({ ...held, [item.category]: itemKey }));
    addRackFromCatalogue(itemKey, rootId);
  };

  const addSource = add("sources");
  const addInstrument = add("instruments");
  const addEffect = add("effects");
  const addComponent = add("components");
  const addSignal = add("signals");
  // Events have no block of their own; they are scheduled on a rack's panel.
  const addEvent = () => {};
  const addDestination = add("outputs");

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
        catalogue={catalogue}
        onPick={pick}
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
