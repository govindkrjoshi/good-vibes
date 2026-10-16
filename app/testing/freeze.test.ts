import { expect, test } from "vitest";
import { deepFreeze } from "./freeze";

test("freezes nested objects and arrays", () => {
  const value = deepFreeze({ a: { b: [1, { c: 2 }] } });

  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(value.a)).toBe(true);
  expect(Object.isFrozen(value.a.b)).toBe(true);
  expect(Object.isFrozen(value.a.b[1])).toBe(true);
  expect(() => {
    (value.a.b as unknown[]).push(3);
  }).toThrow(TypeError);
});

test("hands back primitives unchanged", () => {
  expect(deepFreeze(3)).toBe(3);
  expect(deepFreeze(null)).toBe(null);
});

test("copes with shared and already frozen parts", () => {
  const shared = Object.freeze({ x: 1 });

  expect(() => deepFreeze({ one: shared, two: shared })).not.toThrow();
});
