import { expect, test } from "vitest";
import { catalogue } from ".";

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

// Every string in plain data, skipping anything else, like a rack's code.
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
