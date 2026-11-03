import { expect, test } from "vitest";
import { defineItem, input } from "./kit";
import { emptyRegistry, itemsIn, loadPlugin, unloadPlugin } from "./registry";

const item = (name: string, extra: object = {}) =>
  defineItem("effects", name, {
    description: `${name} test item.`,
    code: "Effect.void",
    ...extra,
  });

const plugin = (id: string, items: unknown[]) => ({
  format: 1,
  id,
  name: id,
  version: "1",
  items,
});

test("files each item under its plugin and name", () => {
  const registry = loadPlugin(emptyRegistry, plugin("a", [item("Echo")]));

  expect(Object.keys(registry.items)).toEqual(["a/Echo"]);
  expect(registry.items["a/Echo"]).toMatchObject({
    key: "a/Echo",
    plugin: "a",
  });
  expect(registry.errors).toEqual([]);
});

test("lets two plugins have items of the same name", () => {
  let registry = loadPlugin(emptyRegistry, plugin("a", [item("Echo")]));
  registry = loadPlugin(registry, plugin("b", [item("Echo")]));

  expect(Object.keys(registry.items)).toEqual(["a/Echo", "b/Echo"]);
});

test("loads plugins from JSON", () => {
  const json = JSON.parse(JSON.stringify(plugin("a", [item("Echo")])));

  expect(loadPlugin(emptyRegistry, json).items["a/Echo"]).toBeDefined();
});

test("reports a bad item and still loads the rest", () => {
  const registry = loadPlugin(
    emptyRegistry,
    plugin("a", [{ type: "leaf", name: "Broken" }, item("Echo")]),
  );

  expect(Object.keys(registry.items)).toEqual(["a/Echo"]);
  expect(registry.errors).toHaveLength(1);
  expect(registry.errors[0]).toMatchObject({ plugin: "a", item: "Broken" });
});

test("reports a plugin that isn't one", () => {
  const registry = loadPlugin(emptyRegistry, { id: "x", items: [] });

  expect(registry.plugins).toEqual({});
  expect(registry.errors[0]?.plugin).toBe("x");
});

test("reports parts of an item that don't fit together", () => {
  const registry = loadPlugin(
    emptyRegistry,
    plugin("a", [
      item("Unkeyed", { jacks: [input(), input(), { direction: "out" }] }),
      item("Orphan", {
        events: [
          {
            kind: "sequence",
            method: "play",
            steps: [],
            subdivision: "8n",
            args: {},
            mute: false,
          },
        ],
      }),
      item("Twice"),
      item("Twice"),
    ]),
  );

  expect(registry.errors.map((error) => error.item)).toEqual([
    "Unkeyed",
    "Orphan",
    "Twice",
  ]);
  expect(Object.keys(registry.items)).toEqual(["a/Twice"]);
});

test("replaces a plugin loaded again, and unloads it", () => {
  let registry = loadPlugin(emptyRegistry, plugin("a", [item("Echo")]));
  registry = loadPlugin(registry, plugin("a", [item("Hall")]));

  expect(Object.keys(registry.items)).toEqual(["a/Hall"]);
  expect(unloadPlugin(registry, "a")).toEqual(emptyRegistry);
});

test("lists a category's items", () => {
  const registry = loadPlugin(emptyRegistry, plugin("a", [item("Echo")]));

  expect(itemsIn(registry, "effects").map((entry) => entry.key)).toEqual([
    "a/Echo",
  ]);
  expect(itemsIn(registry, "sources")).toEqual([]);
});
