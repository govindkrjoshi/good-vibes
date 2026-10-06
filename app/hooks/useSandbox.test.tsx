// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SandboxProvider, useSandbox } from "./useSandbox";

type SandboxApi = ReturnType<typeof useSandbox>;

let container: HTMLDivElement;
let root: Root;
let current: SandboxApi | undefined;

function Probe() {
  current = useSandbox();
  return null;
}

function render(children: ReactNode = <Probe />) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root.render(
      <SandboxProvider sandboxSrc="about:blank">{children}</SandboxProvider>,
    );
  });

  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Code sandbox"]',
  );
  if (iframe === null) throw new Error("sandbox iframe missing");

  return { iframe };
}

beforeEach(() => {
  current = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("renders the iframe as an opaque-origin script-only sandbox", () => {
  const { iframe } = render();

  expect(iframe.getAttribute("src")).toBe("about:blank");
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(iframe.className).toContain("hidden");
});

test("logs to the console once on mount", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  render();

  expect(log).toHaveBeenCalledWith("Sandbox loaded");

  act(() => current?.setCount(3));
  expect(log).toHaveBeenCalledTimes(1);
});

test("starts the counter at zero and updates it through the hook", () => {
  render();

  expect(current?.count).toBe(0);

  act(() => current?.setCount((count) => count + 1));
  expect(current?.count).toBe(1);

  act(() => current?.setCount(7));
  expect(current?.count).toBe(7);

  act(() => current?.setCount(0));
  expect(current?.count).toBe(0);
});

test("throws when used outside the provider", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  expect(() => act(() => root.render(<Probe />))).toThrow(
    "useSandbox must be used inside SandboxProvider",
  );
  error.mockRestore();
});
