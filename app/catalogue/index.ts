import * as Sources from "./sources";
import * as Instruments from "./instruments";
import * as Outputs from "./outputs";
import type { Catalogue, CatalogueItem } from "./common";

export type { Catalogue, CatalogueItem } from "./common";

const byCategoryAndName = (items: readonly CatalogueItem[]): Catalogue => {
  const catalogue: Record<string, Record<string, CatalogueItem>> = {};
  for (const item of items) {
    catalogue[item.category] ??= {};
    catalogue[item.category][item.name] = item;
  }
  return catalogue;
};

export const catalogue: Catalogue = byCategoryAndName([
  ...Sources.items,
  ...Instruments.items,
  ...Outputs.items,
]);
