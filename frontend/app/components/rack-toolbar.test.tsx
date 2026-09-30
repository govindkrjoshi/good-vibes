// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { RackToolbar } from "./rack-toolbar";

let container: HTMLDivElement;
let root: Root;

const handlers = () => ({
  onToggleLock: vi.fn(),
  onAddGroup: vi.fn(),
  onAddSource: vi.fn(),
  onAddInstrument: vi.fn(),
  onAddEffect: vi.fn(),
  onAddComponent: vi.fn(),
  onAddSignal: vi.fn(),
  onAddEvent: vi.fn(),
  onDelete: vi.fn(),
});

const typedTools = [
  {
    testId: "add-source",
    label: "Add source",
    key: "S",
    handler: "onAddSource",
  },
  {
    testId: "add-instrument",
    label: "Add instrument",
    key: "I",
    handler: "onAddInstrument",
  },
  {
    testId: "add-effect",
    label: "Add effect",
    key: "E",
    handler: "onAddEffect",
  },
  {
    testId: "add-component",
    label: "Add component",
    key: "C",
    handler: "onAddComponent",
  },
  {
    testId: "add-signal",
    label: "Add signal",
    key: "L",
    handler: "onAddSignal",
  },
  { testId: "add-event", label: "Add event", key: "V", handler: "onAddEvent" },
] as const;

function render(
  props: ReturnType<typeof handlers>,
  locked = false,
  canDelete = true,
) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() =>
    root.render(
      <RackToolbar locked={locked} canDelete={canDelete} {...props} />,
    ),
  );

  const button = (testId: string) => {
    const found = container.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    if (found === null) throw new Error(`no toolbar button ${testId}`);
    return found;
  };

  return { button };
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

test("names each button for screen readers", () => {
  const { button } = render(handlers());

  expect(button("add-group").getAttribute("aria-label")).toBe("Add group");
  expect(button("toggle-lock").getAttribute("aria-label")).toBe("Lock canvas");
  expect(button("delete-selection").getAttribute("aria-label")).toBe(
    "Delete selection",
  );
  for (const tool of typedTools) {
    expect(button(tool.testId).getAttribute("aria-label")).toBe(tool.label);
  }
});

test("shows the shortcut hint next to each block tool", () => {
  const { button } = render(handlers());

  expect(button("add-group").textContent).toContain("G");
  for (const tool of typedTools) {
    expect(button(tool.testId).textContent).toContain(tool.key);
  }
});

test("marks the lock button active and relabels it while locked", () => {
  const { button } = render(handlers(), true);

  expect(button("toggle-lock").dataset.active).toBe("true");
  expect(button("toggle-lock").getAttribute("aria-pressed")).toBe("true");
  expect(button("toggle-lock").getAttribute("aria-label")).toBe(
    "Unlock canvas",
  );
});

test("announces the lock as a toggle and the block tools as plain buttons", () => {
  const { button } = render(handlers());

  expect(button("toggle-lock").getAttribute("aria-pressed")).toBe("false");
  expect(button("add-group").hasAttribute("aria-pressed")).toBe(false);
  for (const tool of typedTools) {
    expect(button(tool.testId).hasAttribute("aria-pressed")).toBe(false);
  }
});

test("calls the matching handler once per click", () => {
  const props = handlers();
  const { button } = render(props);

  act(() => button("add-group").click());
  expect(props.onAddGroup).toHaveBeenCalledTimes(1);
  expect(props.onToggleLock).not.toHaveBeenCalled();
  expect(props.onDelete).not.toHaveBeenCalled();

  act(() => button("delete-selection").click());
  expect(props.onDelete).toHaveBeenCalledTimes(1);

  act(() => button("toggle-lock").click());
  expect(props.onToggleLock).toHaveBeenCalledTimes(1);
});

test("calls each typed tool's own handler", () => {
  const props = handlers();
  const { button } = render(props);

  for (const tool of typedTools) {
    act(() => button(tool.testId).click());
    expect(props[tool.handler]).toHaveBeenCalledTimes(1);
  }
  expect(props.onAddGroup).not.toHaveBeenCalled();
});

test("puts the typed tools, add group and delete in groups of their own", () => {
  render(handlers());

  const groups = [...container.querySelectorAll('[data-slot="toolbar-group"]')];
  expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
    "Add blocks",
    "Add group",
    "Edit",
  ]);
  expect(groups[1]?.querySelector('[data-testid="add-group"]')).not.toBeNull();
  expect(
    groups[2]?.querySelector('[data-testid="delete-selection"]'),
  ).not.toBeNull();
});

test("disables delete while there is nothing to delete", () => {
  const props = handlers();
  const { button } = render(props, false, false);

  act(() => button("delete-selection").click());
  expect(props.onDelete).not.toHaveBeenCalled();
});
