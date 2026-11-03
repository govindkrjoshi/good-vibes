import { Type } from "@earendil-works/pi-ai";
import type { RackStore } from "../types";
import { jackOf, patchOf, treeOf } from "./lookup";
import { defineTool, oneOf, ToolProblem, type ErrorWatch } from "./tool";

export const patchRule =
  "A patch goes from an output jack to an input jack of a sibling in the same tree. From inside a tree, the tree's own input jacks feed its children (patch tree:in to child:in) and its children feed its output jacks (patch child:out to tree:out). A rack's mod jack (rack:mod:param) is an input that drives that param.";

export const jackTools = (store: RackStore, watch: ErrorWatch) => [
  defineTool({
    name: "add_jack",
    label: "Adding a jack",
    description:
      "Adds an input or output jack to a tree (group). A leaf's jacks are fixed by its spec.",
    parameters: Type.Object({
      rackId: Type.String(),
      direction: oneOf(["in", "out"]),
      name: Type.Optional(Type.String()),
    }),
    run: ({ rackId, direction, name }) => {
      const { rack } = store.getState();
      treeOf(rack, rackId);
      const id = watch.check(() => rack.addJack(rackId, direction, name));
      return `Added jack ${id} (${direction}) on ${rackId}.`;
    },
  }),
  defineTool({
    name: "remove_jack",
    label: "Removing a jack",
    description: "Removes a jack from a tree, with every patch to it.",
    parameters: Type.Object({ jackId: Type.String() }),
    run: ({ jackId }) => {
      const { rack } = store.getState();
      const jack = jackOf(rack, jackId);
      treeOf(rack, jack.belongToBlockId);
      const before = Object.keys(rack.patches).length;
      watch.check(() => rack.removeJack(jackId));
      const gone = before - Object.keys(store.getState().rack.patches).length;
      return `Removed jack ${jackId}${
        gone === 0 ? "" : ` and ${gone} patch(es) to it`
      }.`;
    },
  }),
  defineTool({
    name: "connect",
    label: "Patching",
    description: `Patches a cable between two jacks. ${patchRule}`,
    parameters: Type.Object({
      from: Type.String({ description: "The jack the signal leaves by." }),
      to: Type.String({ description: "The jack it goes into." }),
    }),
    run: ({ from, to }) => {
      const { rack } = store.getState();
      const source = jackOf(rack, from);
      const target = jackOf(rack, to);
      if (!rack.canConnectJacks(from, to)) {
        const place = (id: string) =>
          `${id} is an ${rack.jacks[id]?.direction} jack on ${
            rack.jacks[id]?.belongToBlockId
          } (in ${rack.racks[rack.jacks[id]?.belongToBlockId ?? ""]?.parentId ?? "nothing"})`;
        throw new ToolProblem(
          `${from} can't be patched to ${to}: ${place(from)}, ${place(to)}. ${patchRule}`,
        );
      }
      const held = Object.values(rack.patches).find(
        (patch) => patch.from === from && patch.to === to,
      );
      const id = watch.check(() => rack.connectJacks(from, to));
      return held !== undefined
        ? `${from} was already patched to ${to} as [${held.id}].`
        : `Patched [${id}] ${from} (${source.name}) -> ${to} (${target.name}).`;
    },
  }),
  defineTool({
    name: "disconnect",
    label: "Unpatching",
    description: "Removes patches by id.",
    parameters: Type.Object({ patchIds: Type.Array(Type.String()) }),
    run: ({ patchIds }) => {
      const { rack } = store.getState();
      for (const id of patchIds) patchOf(rack, id);
      watch.check(() => rack.removePatches(patchIds));
      return `Removed ${patchIds.length} patch(es).`;
    },
  }),
];
