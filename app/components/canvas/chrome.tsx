import { useMemo, useRef } from "react";
import { useReactFlow, useStore as useFlowStore } from "@xyflow/react";
import { CanvasMenu } from "./menu";
import { HelpButton } from "./help-button";
import {
  RackToolbar,
  type CatalogueSection,
  type DemoChoice,
} from "./rack-toolbar";
import { ViewportControls } from "./viewport-controls";
import { useShortcuts } from "../../hooks/useShortcuts";
import { useCanvasStore } from "./canvas-store";
import { useStore } from "../../stores";
import { newTree } from "../../rack";
import { demos, rackCount } from "../../demos";
import {
  categories,
  itemsIn,
  specParams,
  type Category,
} from "../../catalogue";

const categoryLabels: Record<Category, string> = {
  sources: "Sources",
  instruments: "Instruments",
  effects: "Effects",
  components: "Components",
  signals: "Signals",
  outputs: "Outputs",
};

export function CanvasChrome() {
  const locked = useCanvasStore((state) => state.locked);
  const toggleLock = useCanvasStore((state) => state.toggleLock);
  const requestArrange = useCanvasStore((state) => state.requestArrange);
  const addRackFromCatalogue = useStore(
    (state) => state.rack.addRackFromCatalogue,
  );
  const addRack = useStore((state) => state.rack.addRack);
  const rootId = useStore((state) => state.rack.rootId);
  const registry = useStore((state) => state.catalogue.registry);
  const clear = useStore((state) => state.rack.clear);
  const load = useStore((state) => state.rack.load);
  const hasRacks = useStore((state) => {
    const root = state.rack.racks[state.rack.rootId];
    return root?.type === "tree" && root.children.length > 0;
  });
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
      categories.map((category) => ({
        category,
        label: categoryLabels[category],
        items: itemsIn(registry, category).map((item) => {
          const jacks = item.jacks ?? [
            { direction: "in" },
            { direction: "out" },
          ];
          return {
            key: item.key,
            name: item.name,
            description: item.description,
            plugin: registry.plugins[item.plugin]?.name ?? item.plugin,
            inputs: jacks.filter((jack) => jack.direction === "in").length,
            params: specParams(item.params).filter((param) => param.patchable)
              .length,
            outputs: jacks.filter((jack) => jack.direction === "out").length,
          };
        }),
      })),
    [registry],
  );
  const focusSearch = useRef<(() => void) | null>(null);
  const pick = (itemKey: string) => addRackFromCatalogue(itemKey, rootId);
  const addDestination = () => pick("tone/Destination");

  const demoChoices = useMemo(
    (): DemoChoice[] =>
      demos.map((demo) => ({
        id: demo.id,
        name: demo.name,
        tagline: demo.tagline,
        racks: rackCount(demo.build(registry)),
      })),
    [registry],
  );
  // A demo arrives as a pile at the origin, so the canvas lays it out.
  const loadDemo = (demoId: string) => {
    const demo = demos.find((held) => held.id === demoId);
    if (demo === undefined) return;
    load(demo.build(registry));
    requestArrange();
  };

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
    d: addDestination,
    "/": () => focusSearch.current?.(),
    backspace: deleteSelection,
    delete: deleteSelection,
  });

  return (
    <>
      <CanvasMenu
        onFitView={() => fitView()}
        onResetZoom={resetZoom}
        onArrange={requestArrange}
      />

      {/* Drops below the menu island wherever the two would meet. */}
      <RackToolbar
        className="@max-2xl/canvas:top-18"
        locked={locked}
        onToggleLock={toggleLock}
        onAddGroup={addTree}
        onAddDestination={addDestination}
        canDelete={canDelete}
        onDelete={deleteSelection}
        canClear={!locked && hasRacks}
        onClear={clear}
        catalogue={catalogue}
        onPick={pick}
        focusSearch={focusSearch}
        demos={demoChoices}
        hasRacks={hasRacks}
        onLoadDemo={loadDemo}
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
