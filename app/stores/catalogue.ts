import type { SliceCreator } from "./common";
import { catalogue, type CatalogueItem } from "../catalogue";

type State = {};

type Actions = {
  findByCategoryAndName: (
    category: string,
    name: string,
  ) => CatalogueItem | undefined;
};

export type CatalogueSlice = State & Actions;

export const createCatalogueSlice: SliceCreator<CatalogueSlice> = () => ({
  findByCategoryAndName: (category, name) => catalogue[category]?.[name],
});
