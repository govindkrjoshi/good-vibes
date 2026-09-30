// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { RackToolbar } from "./rack-toolbar";

let container: HTMLDivElement;
let root: Root;

const handlers = () => ({
  onToggleLock: vi.fn(),
  onAddNode: vi.fn(),
  onAddGroup: vi.fn(),
});

function render(props: ReturnType<typeof handlers>, locked = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => root.render(<RackToolbar locked={locked} {...props} />));

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

  expect(button("add-node").getAttribute("aria-label")).toBe("Add node");
  expect(button("add-group").getAttribute("aria-label")).toBe("Add group");
  expect(button("toggle-lock").getAttribute("aria-label")).toBe("Lock canvas");
});

test("shows the shortcut hint next to each block tool", () => {
  const { button } = render(handlers());

  expect(button("add-node").textContent).toContain("N");
  expect(button("add-group").textContent).toContain("G");
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

  // Only a control with an on state should carry aria-pressed: on "Add node" it
  // would promise an off state that does not exist.
  expect(button("toggle-lock").getAttribute("aria-pressed")).toBe("false");
  expect(button("add-node").hasAttribute("aria-pressed")).toBe(false);
  expect(button("add-group").hasAttribute("aria-pressed")).toBe(false);
});

test("calls the matching handler once per click", () => {
  const props = handlers();
  const { button } = render(props);

  act(() => button("add-node").click());
  expect(props.onAddNode).toHaveBeenCalledTimes(1);
  expect(props.onAddGroup).not.toHaveBeenCalled();
  expect(props.onToggleLock).not.toHaveBeenCalled();

  act(() => button("add-group").click());
  expect(props.onAddGroup).toHaveBeenCalledTimes(1);

  act(() => button("toggle-lock").click());
  expect(props.onToggleLock).toHaveBeenCalledTimes(1);
});
