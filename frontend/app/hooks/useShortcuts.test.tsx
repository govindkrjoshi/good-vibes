// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useShortcuts, type Shortcuts } from "./useShortcuts";

let container: HTMLDivElement;
let root: Root;

function render(shortcuts: Shortcuts) {
  function Probe() {
    useShortcuts(shortcuts);
    return null;
  }

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, ...init }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("runs the handler bound to the key, whatever its case", () => {
  const run = vi.fn();
  render({ r: run });

  press("r");
  press("R");

  expect(run).toHaveBeenCalledTimes(2);
});

test("ignores unbound keys and modified presses", () => {
  const run = vi.fn();
  render({ r: run });

  press("x");
  press("r", { metaKey: true });
  press("r", { ctrlKey: true });
  press("r", { altKey: true });

  expect(run).not.toHaveBeenCalled();
});

test("stays out of the way while typing in a field", () => {
  const run = vi.fn();
  render({ r: run });

  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", bubbles: true }),
    );
  });

  expect(run).not.toHaveBeenCalled();
  input.remove();
});

test("unbinds the listener on unmount", () => {
  const run = vi.fn();
  render({ r: run });

  act(() => root.unmount());
  press("r");
  expect(run).not.toHaveBeenCalled();

  // The shared teardown unmounts again, which React tolerates.
});
