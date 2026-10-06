// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from "vitest";
import {
  apiKeyStorageKey,
  devApiKey,
  knownApiKey,
  storeApiKey,
  storedApiKey,
} from "./agent-key";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

test("has no dev key when the dev server was given none", () => {
  expect(devApiKey()).toBeUndefined();
});

test("round-trips a key through local storage", () => {
  expect(storedApiKey()).toBeUndefined();

  storeApiKey("sk-or-saved");

  expect(localStorage.getItem(apiKeyStorageKey)).toBe("sk-or-saved");
  expect(storedApiKey()).toBe("sk-or-saved");
  expect(knownApiKey()).toBe("sk-or-saved");
});

test("treats a blank stored key as missing", () => {
  localStorage.setItem(apiKeyStorageKey, "   ");

  expect(knownApiKey()).toBeUndefined();
});

test("survives local storage that throws", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });

  expect(() => storeApiKey("sk-or-x")).not.toThrow();
  expect(storedApiKey()).toBeUndefined();
});
