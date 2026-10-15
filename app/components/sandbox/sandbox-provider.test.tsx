// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { noopRuntime, rackStore } from "../../rack";
import { SandboxProvider, useSandbox } from "./sandbox-provider";

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

// What the frame would say as it loads, from its own window or another.
const ready = (source: Window | null, boot = "one") =>
  new MessageEvent("message", {
    data: { channel: "good-vibes:sandbox", type: "ready", boot },
    source,
  });

beforeEach(() => {
  current = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("renders the iframe as a hidden opaque-origin script-only sandbox", () => {
  const { iframe } = render();

  expect(iframe.getAttribute("src")).toBe("about:blank");
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(iframe.getAttribute("allow")).toBe("autoplay");
  expect(iframe.className).toContain("hidden");
});

test("logs to the console once on mount", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  render();

  expect(log).toHaveBeenCalledWith("Sandbox loaded");
  expect(log).toHaveBeenCalledTimes(1);
});

test("plugs the frame's runtime into the rack store while mounted", () => {
  render();

  expect(rackStore.getState().runtime).not.toBe(noopRuntime);

  act(() => root.unmount());
  expect(rackStore.getState().runtime).toBe(noopRuntime);
  render();
});

test("hands a port to its own frame once per load, and to no other window", () => {
  const { iframe } = render();
  const frame = iframe.contentWindow;
  if (frame === null) throw new Error("no frame window");
  const post = vi.spyOn(frame, "postMessage");

  act(() => {
    window.dispatchEvent(ready(window));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: "good-vibes:sandbox", type: "nope" },
        source: frame,
      }),
    );
  });
  expect(post).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(ready(frame));
    window.dispatchEvent(ready(frame));
  });
  expect(post).toHaveBeenCalledTimes(1);
  const [message, , transfer] = post.mock.calls[0] as unknown as [
    unknown,
    string,
    MessagePort[],
  ];
  expect(message).toEqual({ channel: "good-vibes:sandbox", type: "connect" });
  expect(transfer).toHaveLength(1);

  // A frame that loaded again is connected again.
  act(() => window.dispatchEvent(ready(frame, "two")));
  expect(post).toHaveBeenCalledTimes(2);
});

test("starts with no audio state", () => {
  render();

  expect(current?.audio).toBeUndefined();
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
