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
  if (iframe?.contentWindow === null || iframe === null)
    throw new Error("sandbox iframe missing");

  const posted: unknown[] = [];
  vi.spyOn(iframe.contentWindow, "postMessage").mockImplementation(
    (message: unknown) => {
      posted.push(message);
    },
  );

  const reply = (
    message: unknown,
    source: MessageEventSource | null = iframe.contentWindow,
    origin = "",
  ) => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: message, source, origin }),
      );
    });
  };

  return { iframe, posted, reply };
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

test("queues code until the sandbox reports ready", () => {
  const { posted, reply } = render();

  act(() => current?.execute("return 42;"));
  expect(posted).toEqual([]);

  reply({ type: "ready" });

  expect(current?.ready).toBe(true);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ type: "execute", code: "return 42;" });
  expect(typeof (posted[0] as { id?: unknown }).id).toBe("string");
});

test("pings the sandbox when the iframe loads", () => {
  const { iframe, posted } = render();

  act(() => iframe.dispatchEvent(new Event("load")));

  expect(current?.ready).toBe(false);
  expect(posted).toEqual([{ type: "ping" }]);
});

test("posts code immediately after the sandbox is ready", () => {
  const { posted, reply } = render();

  reply({ type: "ready" });
  act(() => current?.execute("return 'ok';"));

  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ type: "execute", code: "return 'ok';" });
});

test("does not trust opaque-origin messages from a different window", () => {
  const { reply } = render();

  reply({ type: "ready" }, null, "null");

  expect(current?.ready).toBe(false);
});

test("stores results and errors for the active execution id", () => {
  const { posted, reply } = render();

  reply({ type: "ready" });
  act(() => current?.execute("return 'done';"));
  const resultId = (posted.at(-1) as { id: string }).id;

  reply({ type: "result", id: "stale", result: "old" });
  expect(current?.result).toBeUndefined();

  reply({ type: "result", id: resultId, result: "done" });
  expect(current?.result).toBe("done");
  expect(current?.error).toBeUndefined();

  act(() => current?.execute("throw new Error('boom');"));
  const errorId = (posted.at(-1) as { id: string }).id;
  reply({ type: "error", id: errorId, error: "boom" });
  expect(current?.error).toBe("boom");
  expect(current?.result).toBeUndefined();
});

test("ignores malformed messages and messages from other windows", () => {
  const { reply } = render();

  reply({ type: "ready" }, window);
  reply({ type: "result", id: "1", result: "wrong source" }, window);
  reply({ type: "result", result: "missing id" });

  expect(current?.ready).toBe(false);
  expect(current?.result).toBeUndefined();
});

test("reports an error when the sandbox never becomes ready", () => {
  vi.useFakeTimers();
  try {
    const { iframe, posted } = render();

    act(() => iframe.dispatchEvent(new Event("load")));
    act(() => current?.execute("return 1;"));
    expect(current?.error).toBeUndefined();

    act(() => vi.advanceTimersByTime(5000));

    expect(current?.ready).toBe(false);
    expect(current?.error).toBe("Sandbox failed to load");
    expect(
      posted.filter((m) => (m as { type: string }).type === "execute"),
    ).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("does not report a load error once the sandbox is ready", () => {
  vi.useFakeTimers();
  try {
    const { iframe, reply } = render();

    act(() => iframe.dispatchEvent(new Event("load")));
    reply({ type: "ready" });
    act(() => vi.advanceTimersByTime(5000));

    expect(current?.ready).toBe(true);
    expect(current?.error).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
