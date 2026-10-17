import type { SliceCreator } from "./common";
import type { CatalogueItem } from "../catalogue";

type State = {
  items: Record<string, CatalogueItem>;
};
