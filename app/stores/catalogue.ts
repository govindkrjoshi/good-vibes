import { castDraft } from "immer";

import type { SliceCreator } from "./common";
import {
  emptyRegistry,
  loadPlugin,
  tonePlugin,
  unloadPlugin,
  type CatalogueEntry,
  type Registry,
} from "../catalogue";

type State = {
  readonly registry: Registry;
};

type Actions = {
  // Loads a plugin from anything, such as parsed JSON; what doesn't fit is
  // reported in the registry's errors.
  readonly loadPlugin: (plugin: unknown) => void;
  readonly unloadPlugin: (pluginId: string) => void;
  readonly findItem: (key: string) => CatalogueEntry | undefined;
};

export type CatalogueSlice = State & Actions;

export const createCatalogueSlice: SliceCreator<CatalogueSlice> = (
  set,
  get,
) => ({
  registry: loadPlugin(emptyRegistry, tonePlugin),
  loadPlugin: (plugin) =>
    set(
      (state) => {
        state.catalogue.registry = castDraft(
          loadPlugin(get().catalogue.registry, plugin),
        );
      },
      false,
      "catalogue/loadPlugin",
    ),
  unloadPlugin: (pluginId) =>
    set(
      (state) => {
        state.catalogue.registry = castDraft(
          unloadPlugin(get().catalogue.registry, pluginId),
        );
      },
      false,
      "catalogue/unloadPlugin",
    ),
  findItem: (key) => get().catalogue.registry.items[key],
});
