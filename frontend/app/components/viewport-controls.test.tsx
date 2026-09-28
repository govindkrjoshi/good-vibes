// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ViewportControls } from "./viewport-controls";

let container: HTMLDivElement;
let root: Root;

const handlers = () => ({
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onResetZoom: vi.fn(),
});

function render(props: ReturnType<typeof handlers>, zoom = 1) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => root.render(<ViewportControls zoom={zoom} {...props} />));

  const button = (testId: string) => {
    const found = container.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    if (found === null) throw new Error(`no button ${testId}`);
    return found;
  };

  return { button };
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("shows the zoom level as a whole percentage", () => {
  const { button } = render(handlers(), 1.337);

  expect(button("zoom-level").textContent).toBe("134%");
});

test("wires each zoom control to its handler", () => {
  const props = handlers();
  const { button } = render(props);

  act(() => button("zoom-in").click());
  expect(props.onZoomIn).toHaveBeenCalledTimes(1);

  act(() => button("zoom-out").click());
  expect(props.onZoomOut).toHaveBeenCalledTimes(1);

  act(() => button("zoom-level").click());
  expect(props.onResetZoom).toHaveBeenCalledTimes(1);
});

test("disables undo and redo until history exists", () => {
  const { button } = render(handlers());

  expect(button("undo").disabled).toBe(true);
  expect(button("redo").disabled).toBe(true);
});
