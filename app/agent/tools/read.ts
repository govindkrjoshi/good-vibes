import { Type } from "@earendil-works/pi-ai";
import { categories } from "../../catalogue";
import type { RackStore } from "../types";
import {
  describeCatalogue,
  describeItem,
  describeOneRack,
  describeRackTree,
} from "./describe";
import { resolveItem } from "./lookup";
import { defineTool, oneOf, ToolProblem } from "./tool";

export const readTools = (store: RackStore) => [
  defineTool({
    name: "read_rack",
    label: "Reading the rack",
    description:
      "Reads the rack. With no rackId: every rack nested under its tree, every patch, the transport and any errors. With a rackId: that rack's jacks, params with their current values, methods, events and automations, with the ids to act on them. Pass withCode to see a leaf's code.",
    parameters: Type.Object({
      rackId: Type.Optional(Type.String()),
      withCode: Type.Optional(Type.Boolean()),
    }),
    run: ({ rackId, withCode }) => {
      const state = store.getState().rack;
      if (rackId === undefined) return describeRackTree(state);
      const text = describeOneRack(state, rackId, { withCode });
      if (text === undefined) {
        throw new ToolProblem(
          `There is no rack ${rackId}. Call read_rack with no id to see them.`,
        );
      }
      return text;
    },
  }),
  defineTool({
    name: "read_catalogue",
    label: "Reading the catalogue",
    description:
      "Reads the catalogue of items a rack can be made from. With no key: lists items as key — description, filtered by query words and category. With a key: that item in full, with its param paths, jacks and methods. Pass withCode to see its code, as a model for writing your own.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Words to look for; an item matches when any of them appears in its name or description.",
        }),
      ),
      category: Type.Optional(oneOf(categories)),
      key: Type.Optional(
        Type.String({ description: "An item, as plugin/Name." }),
      ),
      withCode: Type.Optional(Type.Boolean()),
    }),
    run: ({ query, category, key, withCode }) => {
      const { registry } = store.getState().catalogue;
      if (key !== undefined) {
        return describeItem(resolveItem(registry, key), { withCode });
      }
      return describeCatalogue(registry, { query, category });
    },
  }),
];
