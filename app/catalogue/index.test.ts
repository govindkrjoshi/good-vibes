import { expect, test } from "vitest";
import { CATALOGUE, catalogueTemplate, categories, subCategories } from ".";

test("lists every category", () => {
  expect(categories()).toEqual(["source", "instruments", "output"]);
});

test("lists the sub categories of a category", () => {
  expect(subCategories("source").map((entry) => entry.name)).toEqual([
    "AMOscillator",
  ]);
});

test("has no sub categories for an unknown category", () => {
  expect(subCategories("nope")).toEqual([]);
});

test("finds a template by category and entry", () => {
  expect(catalogueTemplate("instruments", "AMSynth")).toBe(
    CATALOGUE.instruments.AMSynth.rack,
  );
  expect(catalogueTemplate("instruments", "Missing")).toBeUndefined();
});
