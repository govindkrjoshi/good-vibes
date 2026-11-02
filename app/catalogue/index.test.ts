import { expect, test } from "vitest";
import { Effect } from "effect";
import { catalogue } from ".";
import { evalLeafCode } from "../rack/renderer";

test("files every item under its category and name", () => {
  expect(
    Object.entries(catalogue).flatMap(([category, items]) =>
      Object.keys(items).map((name) => `${category}/${name}`),
    ),
  ).toEqual([
    "source/AMOscillator",
    "instruments/AMSynth",
    "output/Destination",
  ]);
  for (const [category, items] of Object.entries(catalogue)) {
    for (const [name, item] of Object.entries(items)) {
      expect([item.category, item.name]).toEqual([category, name]);
    }
  }
});

// Text can't be typechecked, so this is what catches a typo in a rack's code.
test("gives every leaf code that evals to an Effect", () => {
  for (const items of Object.values(catalogue)) {
    for (const { rack } of Object.values(items)) {
      if (rack.type === "leaf") {
        expect(Effect.isEffect(evalLeafCode(rack.code))).toBe(true);
      }
    }
  }
});

// Every string in plain data.
const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.entries(value).flatMap(([key, held]) => [
      key,
      ...strings(held),
    ]);
  }
  return [];
};

// The store gives each copy of an item its own ids by swapping the rack id at
// the front of every id the item owns, so none may be named any other way.
test("starts every id an item owns with its rack's id", () => {
  for (const items of Object.values(catalogue)) {
    for (const item of Object.values(items)) {
      const ids = strings(item).filter((held) => held.includes("catalogue:"));
      expect(ids.length).toBeGreaterThan(1);
      for (const id of ids) {
        expect(id === item.rack.id || id.startsWith(`${item.rack.id}:`)).toBe(
          true,
        );
      }
    }
  }
});

test("joins each event to a method its rack has", () => {
  const { methods, events } = catalogue.instruments.AMSynth;

  expect(Object.values(events).map((event) => event.methodId)).toEqual([
    "catalogue:instruments:AMSynth:method:triggerAttackRelease",
  ]);
  for (const event of Object.values(events)) {
    expect(methods[event.methodId]).toBeDefined();
  }
});
