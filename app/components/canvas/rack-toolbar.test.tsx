// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { RackToolbar, type CatalogueSection } from "./rack-toolbar";

let container: HTMLDivElement;
let root: Root;

const handlers = () => ({
  onToggleLock: vi.fn(),
  onAddGroup: vi.fn(),
  onAddDestination: vi.fn(),
  onDelete: vi.fn(),
  onClear: vi.fn(),
  onPick: vi.fn(),
  onLoadDemo: vi.fn(),
});

const demos = [
  { id: "dub", name: "Dub", tagline: "An echo.", racks: 10 },
  { id: "garden", name: "Garden", tagline: "A pad.", racks: 20 },
];

const item = (name: string, description: string) => ({
  key: `tone/${name}`,
  name,
  description,
  plugin: "Tone.js",
  inputs: 1,
  params: 0,
  outputs: 1,
});

const catalogue: CatalogueSection[] = [
  {
    category: "sources",
    label: "Sources",
    items: [item("Noise", "Hiss of every kind.")],
  },
  {
    category: "effects",
    label: "Effects",
    items: [
      item("Chorus", "Copies with wavering delays."),
      item("FeedbackDelay", "An echo that fades."),
      item("Freeverb", "A reverb built from comb filters."),
    ],
  },
  {
    category: "components",
    label: "Components",
    items: [item("Filter", "Cuts some frequencies.")],
  },
];

function render(
  props: ReturnType<typeof handlers>,
  { locked = false, canDelete = true, canClear = true, hasRacks = false } = {},
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() =>
    root.render(
      <RackToolbar
        locked={locked}
        canDelete={canDelete}
        canClear={canClear}
        catalogue={catalogue}
        demos={demos}
        hasRacks={hasRacks}
        {...props}
      />,
    ),
  );

  const find = <E extends HTMLElement>(testId: string) => {
    const found = document.querySelector<E>(`[data-testid="${testId}"]`);
    if (found === null) throw new Error(`no ${testId}`);
    return found;
  };
  const search = () => find<HTMLInputElement>("catalogue-search");
  const options = () =>
    [...document.querySelectorAll('[role="option"]')].map(
      (option) => option.querySelector("span")?.textContent,
    );
  const type = (text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search(), text);
      search().dispatchEvent(new Event("input", { bubbles: true }));
    });
  const press = (key: string) =>
    act(() => {
      search().dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  const focusSearch = () => act(() => search().focus());

  return { find, search, options, type, press, focusSearch };
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("renders a labelled toolbar", () => {
  render(handlers());

  const toolbar = container.querySelector('[data-slot="toolbar"]');
  expect(toolbar?.getAttribute("role")).toBe("toolbar");
  expect(toolbar?.getAttribute("aria-label")).toBe("Rack tools");
});

test("names each tool for screen readers", () => {
  const { find } = render(handlers());

  expect(find("toggle-lock").getAttribute("aria-label")).toBe("Lock canvas");
  expect(find("catalogue-search").getAttribute("aria-label")).toBe(
    "Find a module",
  );
  expect(find("add-group").getAttribute("aria-label")).toBe("Add group");
  expect(find("add-destination").getAttribute("aria-label")).toBe(
    "Add destination",
  );
  expect(find("delete-selection").getAttribute("aria-label")).toBe(
    "Delete selection",
  );
  expect(find("clear-canvas").getAttribute("aria-label")).toBe("Clear canvas");
  expect(find("load-demo").getAttribute("aria-label")).toBe("Load a demo");
});

test("shows the shortcut hint on the tools that have one", () => {
  const { find } = render(handlers());

  expect(find("add-group").textContent).toContain("G");
  expect(find("add-destination").textContent).toContain("D");
});

test("puts the adding tools and the removing tools in groups of their own", () => {
  render(handlers());

  const groups = [...container.querySelectorAll('[data-slot="toolbar-group"]')];
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
    "Add",
    "Edit",
    "Demos",
  ]);
  expect(groups[0]?.querySelector('[data-testid="add-group"]')).not.toBeNull();
  expect(
    groups[1]?.querySelector('[data-testid="clear-canvas"]'),
  ).not.toBeNull();
  expect(groups[2]?.querySelector('[data-testid="load-demo"]')).not.toBeNull();
});

test("marks the lock button active and relabels it while locked", () => {
  const { find } = render(handlers(), { locked: true });

  expect(find("toggle-lock").dataset.active).toBe("true");
  expect(find("toggle-lock").getAttribute("aria-pressed")).toBe("true");
  expect(find("toggle-lock").getAttribute("aria-label")).toBe("Unlock canvas");
});

test("calls the matching handler once per click", () => {
  const props = handlers();
  const { find } = render(props);

  act(() => find("add-group").click());
  act(() => find("add-destination").click());
  act(() => find("delete-selection").click());
  act(() => find("toggle-lock").click());

  expect(props.onAddGroup).toHaveBeenCalledTimes(1);
  expect(props.onAddDestination).toHaveBeenCalledTimes(1);
  expect(props.onDelete).toHaveBeenCalledTimes(1);
  expect(props.onToggleLock).toHaveBeenCalledTimes(1);
});

test("disables delete and clear while there is nothing to take away", () => {
  const props = handlers();
  const { find } = render(props, { canDelete: false, canClear: false });

  act(() => find("delete-selection").click());
  act(() => find("clear-canvas").click());
  expect(props.onDelete).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="confirm-clear"]')).toBeNull();
});

test("clears the canvas only once it is confirmed", () => {
  const props = handlers();
  const { find } = render(props);

  act(() => find("clear-canvas").click());
  expect(props.onClear).not.toHaveBeenCalled();

  act(() => find("confirm-clear").click());
  expect(props.onClear).toHaveBeenCalledTimes(1);
});

test("lists the demos with their size and loads the one picked", () => {
  const props = handlers();
  const { find } = render(props);

  act(() => find("load-demo").click());
  expect(document.body.textContent).toContain("10 racks");
  expect(document.body.textContent).toContain("A pad.");

  act(() => find("demo-garden").click());
  expect(props.onLoadDemo).toHaveBeenCalledWith("garden");
  expect(props.onLoadDemo).toHaveBeenCalledTimes(1);
  expect(find("load-demo").getAttribute("aria-expanded")).toBe("false");
});

test("asks before a demo replaces racks on the canvas", () => {
  const props = handlers();
  const { find } = render(props, { hasRacks: true });

  act(() => find("load-demo").click());
  act(() => find("demo-dub").click());
  expect(props.onLoadDemo).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Replace the canvas with Dub?");

  act(() => find("confirm-load-demo").click());
  expect(props.onLoadDemo).toHaveBeenCalledWith("dub");
});

test("keeps the demos out of reach while the canvas is locked", () => {
  const props = handlers();
  const { find } = render(props, { locked: true });

  act(() => find("load-demo").click());
  expect(document.querySelector('[data-testid="demo-dub"]')).toBeNull();
});

test("drops the catalogue down when the search takes focus", () => {
  const { focusSearch, search, options } = render(handlers());
  expect(options()).toEqual([]);

  focusSearch();

  expect(search().getAttribute("aria-expanded")).toBe("true");
  expect(options()).toEqual(["Noise"]);
});

test("browses a category picked from the side list", () => {
  const { focusSearch, find, options } = render(handlers());
  focusSearch();

  act(() => find("catalogue-effects").click());

  expect(options()).toEqual(["Chorus", "FeedbackDelay", "Freeverb"]);
});

test("searches every category, names before descriptions", () => {
  const { focusSearch, type, options } = render(handlers());
  focusSearch();

  type("filter");
  expect(options()).toEqual(["Filter", "Freeverb"]);

  type("echo");
  expect(options()).toEqual(["FeedbackDelay"]);
});

test("says what to try when nothing matches", () => {
  const { focusSearch, type, options } = render(handlers());
  focusSearch();

  type("theremin");

  expect(options()).toEqual([]);
  expect(document.body.textContent).toContain("No module matches");
});

test("adds the highlighted module on Enter and closes the list", () => {
  const props = handlers();
  const { focusSearch, type, press, search } = render(props);
  focusSearch();

  type("e");
  press("ArrowDown");
  press("Enter");

  expect(props.onPick).toHaveBeenCalledWith("tone/FeedbackDelay");
  expect(search().getAttribute("aria-expanded")).toBe("false");
  expect(search().value).toBe("");
});

test("closes the list on Escape", () => {
  const { focusSearch, press, search } = render(handlers());
  focusSearch();

  press("Escape");

  expect(search().getAttribute("aria-expanded")).toBe("false");
});

test("tells a screen reader what each module connects by", () => {
  const { focusSearch } = render(handlers());
  focusSearch();

  expect(
    document.querySelector('[role="option"]')?.getAttribute("aria-description"),
  ).toBe("Hiss of every kind. 1 input, 1 output.");
});
