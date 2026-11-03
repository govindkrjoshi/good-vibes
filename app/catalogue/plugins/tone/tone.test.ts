import { Effect } from "effect";
import { expect, test } from "vitest";
import { tonePlugin } from ".";
import { evalLeafCode } from "../../../rack/renderer";
import { emptyRegistry, loadPlugin } from "../../registry";
import { decodeItem, encodeItem } from "../../spec";

// A built-in item that the schema can't carry is one a user or agent plugin
// couldn't write, so every one has to survive the trip.
test("survives the trip through the schema, as a plugin's JSON would", () => {
  for (const item of tonePlugin.items) {
    expect(decodeItem(JSON.parse(JSON.stringify(encodeItem(item))))).toEqual(
      item,
    );
  }
});

test("loads with no errors", () => {
  const registry = loadPlugin(emptyRegistry, tonePlugin);

  expect(registry.errors).toEqual([]);
  expect(Object.keys(registry.items)).toHaveLength(tonePlugin.items.length);
});

// Text can't be typechecked, so this is what catches a typo in an item's code.
test("gives every item code that evals to an Effect", () => {
  for (const item of tonePlugin.items) {
    expect(Effect.isEffect(evalLeafCode(item.code)), item.name).toBe(true);
  }
});

test("describes every item", () => {
  for (const item of tonePlugin.items) {
    expect(item.description.length, item.name).toBeGreaterThan(10);
  }
});
