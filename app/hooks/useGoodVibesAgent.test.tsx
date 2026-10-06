// @vitest-environment happy-dom

import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { apiKeyStorageKey } from "../agent-key";
import {
  GoodVibesAgentProvider,
  useAgentGreeting,
  useGoodVibesAgent,
} from "./useGoodVibesAgent";

const runGoodVibesAgent = vi.hoisted(() => vi.fn());
vi.mock("../agent", () => ({ runGoodVibesAgent }));

let container: HTMLDivElement;
let root: Root;
let current: ReturnType<typeof useGoodVibesAgent> | undefined;

function Probe() {
  current = useGoodVibesAgent();
  return null;
}

function Greeter({ label = "" }: { readonly label?: string }) {
  useAgentGreeting();
  return label;
}

const tree = (children: ReactNode) => (
  <StrictMode>
    <GoodVibesAgentProvider>{children}</GoodVibesAgentProvider>
  </StrictMode>
);

function render(children: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(tree(children)));
}

// Lets pending promises (the lazy agent import, the reply) settle.
const flush = () => act(async () => {});

const keyInput = () =>
  document.querySelector<HTMLInputElement>('input[type="password"]');

const button = (name: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
};

function enterKey(key: string) {
  const input = keyInput();
  if (input === null) throw new Error("key dialog missing");
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, key);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => button("Save key").click());
}

beforeEach(() => {
  current = undefined;
  runGoodVibesAgent.mockResolvedValue("Hi there");
  // happy-dom's dialog does not implement the modal API.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
  runGoodVibesAgent.mockReset();
  vi.restoreAllMocks();
});

test("uses the key saved in local storage without asking", async () => {
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  render(<Probe />);

  await expect(current?.prompt("hello")).resolves.toBe("Hi there");
  expect(runGoodVibesAgent).toHaveBeenCalledWith("hello", "sk-or-saved");
  expect(keyInput()).toBeNull();
});

test("asks for a key when none is known, then saves it", async () => {
  render(<Probe />);

  let reply: Promise<string> | undefined;
  act(() => {
    reply = current?.prompt("hello");
  });
  expect(keyInput()).not.toBeNull();
  expect(runGoodVibesAgent).not.toHaveBeenCalled();

  enterKey("  sk-or-typed  ");
  await flush();

  await expect(reply).resolves.toBe("Hi there");
  expect(runGoodVibesAgent).toHaveBeenCalledWith("hello", "sk-or-typed");
  expect(localStorage.getItem(apiKeyStorageKey)).toBe("sk-or-typed");
  expect(keyInput()).toBeNull();
});

test("prompts waiting on the key share one dialog", async () => {
  render(<Probe />);

  let first: Promise<string> | undefined;
  let second: Promise<string> | undefined;
  act(() => {
    first = current?.prompt("one");
    second = current?.prompt("two");
  });
  expect(document.querySelectorAll("dialog")).toHaveLength(1);

  enterKey("sk-or-typed");
  await flush();

  await expect(first).resolves.toBe("Hi there");
  await expect(second).resolves.toBe("Hi there");
});

test("rejects when the user declines to give a key", async () => {
  render(<Probe />);

  let reply: Promise<string> | undefined;
  act(() => {
    reply = current?.prompt("hello");
  });
  act(() => button("Not now").click());

  await expect(reply).rejects.toThrow("No OpenRouter API key was given");
  expect(runGoodVibesAgent).not.toHaveBeenCalled();
  expect(keyInput()).toBeNull();
});

test("greets once on mount under Strict Mode and logs the reply", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  runGoodVibesAgent.mockResolvedValue("Welcome to Good Vibes!");

  render(<Greeter />);
  await flush();

  expect(runGoodVibesAgent).toHaveBeenCalledTimes(1);
  expect(runGoodVibesAgent).toHaveBeenCalledWith(
    "Say hello to the user of Good Vibes.",
    "sk-or-saved",
  );
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("Welcome to Good Vibes!");
});

test("does not greet again on rerender", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");

  render(<Greeter label="a" />);
  await flush();
  act(() => root.render(tree(<Greeter label="b" />)));
  await flush();

  expect(container.textContent).toBe("b");
  expect(runGoodVibesAgent).toHaveBeenCalledTimes(1);
});

test("warns instead of throwing when the greeting fails", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  localStorage.setItem(apiKeyStorageKey, "sk-or-saved");
  runGoodVibesAgent.mockRejectedValue(new Error("401 Unauthorized"));

  render(<Greeter />);
  await flush();

  expect(log).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toBe("Agent greeting failed:");
});

test("throws when used outside the provider", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  expect(() => act(() => root.render(<Probe />))).toThrow(
    "useGoodVibesAgent must be used inside GoodVibesAgentProvider",
  );
});
