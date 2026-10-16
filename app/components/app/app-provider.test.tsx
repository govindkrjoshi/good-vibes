// @vitest-environment happy-dom

import { Effect, PubSub, Stream } from "effect";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AgentService, CreateAgent, GoodVibesMessage } from "../../agent";
import type { GoodVibesAgent } from "../../agent/agent";
import { edits, rackEnvelope, rackStore } from "../../rack";
import { workListenerCount } from "../../rack/store";
import { liveRuntimes } from "../../runtime";
import {
  initialSandboxStatus,
  sandboxStatus,
  type SandboxClient,
} from "../../sandbox";
import { AppProvider, useAgentService, useSandboxClient } from "./app-provider";

// An agent whose replies never end until interrupted.
const aborted = vi.fn();
const createAgent: CreateAgent = () =>
  Effect.gen(function* () {
    const said = yield* PubSub.unbounded<GoodVibesMessage>();
    return {
      prompt: () =>
        Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(aborted))),
      messages: Stream.fromPubSub(said),
      abort: Effect.void,
    } satisfies GoodVibesAgent;
  });

let container: HTMLDivElement;
let root: Root;
let sandbox: SandboxClient | undefined;
let agent: AgentService | undefined;

function Probe() {
  sandbox = useSandboxClient();
  agent = useAgentService();
  return null;
}

const tree = (strict: boolean) => {
  const app = (
    <AppProvider sandboxSrc="about:blank" createAgent={createAgent}>
      <Probe />
    </AppProvider>
  );
  return strict ? <StrictMode>{app}</StrictMode> : app;
};

function mount(strict = true): HTMLIFrameElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(tree(strict)));
  const iframe = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Code sandbox"]',
  );
  if (iframe === null) throw new Error("sandbox iframe missing");
  return iframe;
}

const unmount = () => {
  act(() => root.unmount());
  container.remove();
};

// Lets disposals, fibers and pending promises settle.
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
  });

// What the frame says as it loads, from its own window or another.
const ready = (source: Window | null, boot = "one") =>
  new MessageEvent("message", {
    data: { channel: "good-vibes:sandbox", type: "ready", boot },
    source,
  });

const initial = rackStore.getState();

beforeEach(() => {
  rackStore.setState(initial, true);
  sandboxStatus.setState(initialSandboxStatus, true);
  localStorage.setItem("good-vibes:openrouter-api-key", "sk-or-test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  if (container.isConnected) unmount();
  await flush();
  localStorage.clear();
  vi.restoreAllMocks();
  aborted.mockReset();
});

// --- The frame ------------------------------------------------------------------

test("renders the frame as a hidden opaque-origin script-only sandbox", () => {
  const iframe = mount();

  expect(iframe.getAttribute("src")).toBe("about:blank");
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
  expect(iframe.getAttribute("allow")).toBe("autoplay");
  expect(iframe.className).toContain("hidden");
});

test("logs once the frame is wired up", () => {
  mount(false);

  expect(console.log).toHaveBeenCalledWith("Sandbox loaded");
  expect(console.log).toHaveBeenCalledTimes(1);
});

test("hands a port to its own frame once per load, and to no other window", () => {
  const iframe = mount();
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
  expect(sandboxStatus.getState().connection).toEqual({
    _tag: "Connected",
    gen: 1,
  });

  // A frame that loaded again is connected again.
  act(() => window.dispatchEvent(ready(frame, "two")));
  expect(post).toHaveBeenCalledTimes(2);
});

// --- Lifecycle --------------------------------------------------------------------

test("under StrictMode, mounting leaves one runtime and one subscription", async () => {
  mount();
  await flush();

  expect(liveRuntimes()).toBe(1);
  expect(workListenerCount()).toBe(1);
  expect(sandbox).toBeDefined();
  expect(agent).toBeDefined();

  unmount();
  await flush();
  expect(liveRuntimes()).toBe(0);
  expect(workListenerCount()).toBe(0);

  mount();
  await flush();
  expect(liveRuntimes()).toBe(1);
  expect(workListenerCount()).toBe(1);
});

test("unmounting during a turn stops the reply", async () => {
  mount();
  await flush();

  act(() => agent?.prompt("hello"));
  await flush();
  expect(agent?.chat.getState().busy).toBe(true);

  unmount();
  await flush();

  expect(aborted).toHaveBeenCalledTimes(1);
  expect(liveRuntimes()).toBe(0);
});

test("unmounting with a batch in flight lets go of the frame, and writes nothing after", async () => {
  const iframe = mount();
  await flush();
  act(() => window.dispatchEvent(ready(iframe.contentWindow)));
  rackStore.getState().dispatch(rackEnvelope(edits.addBlock("leaf")));
  expect(sandboxStatus.getState().pending).toBe(1);
  const waiting =
    sandbox === undefined
      ? undefined
      : Effect.runPromise(sandbox.barrier(10_000));

  unmount();
  await flush();

  expect(await waiting).toEqual({ _tag: "Disconnected" });
  expect(sandboxStatus.getState()).toEqual(initialSandboxStatus);
  rackStore.getState().dispatch(rackEnvelope(edits.addBlock("leaf")));
  rackStore.getState().dispatch(rackEnvelope(edits.run()));
  await flush();
  expect(sandboxStatus.getState()).toEqual(initialSandboxStatus);
});

test("after a remount, the frame is connected afresh", async () => {
  const first = mount();
  await flush();
  act(() => window.dispatchEvent(ready(first.contentWindow)));
  unmount();
  await flush();
  expect(sandboxStatus.getState().connection).toEqual({ _tag: "Disconnected" });

  const second = mount();
  await flush();
  const post = vi.spyOn(second.contentWindow as Window, "postMessage");
  act(() => window.dispatchEvent(ready(second.contentWindow)));

  expect(post).toHaveBeenCalledWith(
    { channel: "good-vibes:sandbox", type: "connect" },
    "*",
    expect.any(Array),
  );
  expect(sandboxStatus.getState().connection).toEqual({
    _tag: "Connected",
    gen: 1,
  });
});
