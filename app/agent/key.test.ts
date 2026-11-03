// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from "vitest";
import {
  credentialStorageKey,
  devCredential,
  knownCredential,
  legacyApiKeyStorageKey,
  storeCredential,
  storedCredential,
} from "./key";
import { detectProvider } from "./providers";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

test("has no dev key when the dev server was given none", () => {
  expect(devCredential()).toBeUndefined();
});

test("round-trips a key and its service through local storage", () => {
  expect(storedCredential()).toBeUndefined();

  storeCredential({ provider: "anthropic", key: "sk-ant-saved" });

  expect(JSON.parse(localStorage.getItem(credentialStorageKey)!)).toEqual({
    provider: "anthropic",
    key: "sk-ant-saved",
  });
  expect(knownCredential()).toEqual({
    provider: "anthropic",
    key: "sk-ant-saved",
  });
});

test("carries over an OpenRouter key saved before, then drops the old entry", () => {
  localStorage.setItem(legacyApiKeyStorageKey, "sk-or-old");

  expect(knownCredential()).toEqual({
    provider: "openrouter",
    key: "sk-or-old",
  });

  storeCredential({ provider: "openai", key: "sk-new" });
  expect(localStorage.getItem(legacyApiKeyStorageKey)).toBeNull();
  expect(knownCredential()).toEqual({ provider: "openai", key: "sk-new" });
});

test("treats a blank, broken or unknown stored key as missing", () => {
  localStorage.setItem(
    credentialStorageKey,
    JSON.stringify({ provider: "openai", key: "   " }),
  );
  expect(knownCredential()).toBeUndefined();

  localStorage.setItem(credentialStorageKey, "{not json");
  expect(knownCredential()).toBeUndefined();

  localStorage.setItem(
    credentialStorageKey,
    JSON.stringify({ provider: "elsewhere", key: "k" }),
  );
  expect(knownCredential()).toBeUndefined();
});

test("survives local storage that throws", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  vi.stubGlobal("localStorage", {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  });

  expect(() =>
    storeCredential({ provider: "openrouter", key: "sk-or-x" }),
  ).not.toThrow();
  expect(storedCredential()).toBeUndefined();
});

test("tells the service from the key's prefix", () => {
  expect(detectProvider("sk-or-v1-abc")).toBe("openrouter");
  expect(detectProvider(" sk-ant-api03-abc")).toBe("anthropic");
  expect(detectProvider("sk-proj-abc")).toBe("openai");
  expect(detectProvider("sk-abc")).toBe("openai");
  expect(detectProvider("hello")).toBeUndefined();
});
