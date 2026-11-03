import { Type } from "@earendil-works/pi-ai";
import { instantiate, paramId } from "../../catalogue";
import { demos } from "../../demos";
import {
  flattenParams,
  newTree,
  valueProblems,
  type ParamValue,
  type RackState,
} from "../../rack";
import type { RackStore } from "../types";
import { describeOneRack, describeRackTree } from "./describe";
import { leafOf, newRackId, notRoot, resolveItem, treeOf } from "./lookup";
import { ItemSpecInput, toItemSpec } from "./spec";
import { defineTool, refuse, ToolProblem, type ErrorWatch } from "./tool";

const ParamValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
]);

const idField = Type.Optional(
  Type.String({
    description:
      "A short id of your choosing, such as bass or pad-filter; made from the name when left out. Jacks, params and methods are named under it.",
  }),
);

const parentField = Type.Optional(
  Type.String({ description: "The tree to put it in; default the root." }),
);

// Values by param path checked against the params the rack will have, so a
// wrong one stops the rack being added at all.
const valueChanges = (
  rackId: string,
  placed: ReturnType<typeof instantiate>,
  values: Record<string, ParamValue>,
) => {
  const params = flattenParams(placed.paramGroup);
  const problems: string[] = [];
  const changes = Object.entries(values).flatMap(([path, value]) => {
    const id = paramId(rackId, path.split("."));
    const param = params.find((held) => held.id === id);
    if (param === undefined) {
      problems.push(
        `${placed.rack.name} has no param ${path}; it has ${params
          .map((held) => held.path.join("."))
          .join(", ")}`,
      );
      return [];
    }
    problems.push(...valueProblems(param, value));
    return [{ id, value }];
  });
  refuse(problems);
  return changes;
};

const patchIds = (state: RackState) => Object.keys(state.patches);

const dropped = (before: readonly string[], after: readonly string[]) =>
  before.filter((id) => !after.includes(id));

const describeNew = (store: RackStore, rackId: string) =>
  describeOneRack(store.getState().rack, rackId) ?? "";

export const rackTools = (store: RackStore, watch: ErrorWatch) => [
  defineTool({
    name: "add_rack",
    label: "Adding a rack",
    description:
      "Places a catalogue item as a new rack, with any of its params set. Returns the rack with every id it has.",
    parameters: Type.Object({
      item: Type.String({ description: "The item's key, as plugin/Name." }),
      id: idField,
      parent: parentField,
      values: Type.Optional(
        Type.Record(Type.String(), ParamValueSchema, {
          description:
            'Param values by dotted path, such as {"volume": -6, "envelope.attack": 0.01}.',
        }),
      ),
    }),
    run: ({ item, id, parent, values = {} }) => {
      const { rack, catalogue } = store.getState();
      const entry = resolveItem(catalogue.registry, item);
      const parentId = parent ?? rack.rootId;
      treeOf(rack, parentId);
      const rackId = newRackId(rack, entry.name, id);
      const changes = valueChanges(
        rackId,
        instantiate(entry, rackId, entry.key),
        values,
      );
      watch.check(() => rack.addItem(entry, parentId, rackId, entry.key));
      for (const change of changes) {
        watch.check(() => rack.setParamValue(change.id, change.value));
      }
      return [
        `Added [${rackId}] ${entry.name} from ${entry.key} in ${parentId}.`,
        describeNew(store, rackId),
      ].join("\n");
    },
  }),
  defineTool({
    name: "create_rack",
    label: "Creating a rack",
    description:
      "Makes a new rack from a spec of your own, with its code, when no catalogue item does what is needed. Read a similar item with read_catalogue withCode first and start from it. The sandbox builds the node once the rack is placed; if its code or a param path fails you will be told, and can fix it with update_rack.",
    parameters: Type.Object({
      spec: ItemSpecInput,
      id: idField,
      parent: parentField,
    }),
    run: ({ spec, id, parent }) => {
      const { rack } = store.getState();
      const item = toItemSpec(spec);
      const parentId = parent ?? rack.rootId;
      treeOf(rack, parentId);
      const rackId = newRackId(rack, item.name, id);
      watch.check(() => rack.addItem(item, parentId, rackId));
      return [
        `Created [${rackId}] ${item.name} in ${parentId} from your spec.`,
        describeNew(store, rackId),
        "The sandbox is building it now; a problem with the code or a param path will be reported to you.",
      ].join("\n");
    },
  }),
  defineTool({
    name: "update_rack",
    label: "Updating a rack",
    description:
      "Makes a leaf rack over from a new spec, whether it came from the catalogue or from you: new code, params, jacks, methods or events. It keeps its id and place, the values of params it still has, patches to jacks it still has, and events added to it since whose method it still has. Read it with read_rack withCode first and send the whole spec back changed.",
    parameters: Type.Object({
      rackId: Type.String(),
      spec: ItemSpecInput,
    }),
    run: ({ rackId, spec }) => {
      const { rack } = store.getState();
      leafOf(rack, rackId);
      const item = toItemSpec(spec);
      const before = patchIds(rack);
      watch.check(() => rack.replaceItem(rackId, item));
      const gone = dropped(before, patchIds(store.getState().rack));
      return [
        `Updated [${rackId}] to ${item.name}.${
          gone.length === 0
            ? ""
            : ` Dropped ${gone.length} patch(es) to jacks it no longer has.`
        }`,
        describeNew(store, rackId),
        "The sandbox is building it again now; a problem with the code or a param path will be reported to you.",
      ].join("\n");
    },
  }),
  defineTool({
    name: "add_group",
    label: "Adding a group",
    description:
      "Adds a tree (group) racks can go inside, with named input and output jacks. Inside it, a child's output patches to a sibling's input; the group's own input jacks feed its children, and its children feed its output jacks.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Default Group." })),
      id: idField,
      parent: parentField,
      inputs: Type.Optional(
        Type.Array(Type.String(), { description: "Names of its input jacks." }),
      ),
      outputs: Type.Optional(
        Type.Array(Type.String(), {
          description: "Names of its output jacks.",
        }),
      ),
    }),
    run: ({ name = "Group", id, parent, inputs = [], outputs = [] }) => {
      const { rack } = store.getState();
      const parentId = parent ?? rack.rootId;
      treeOf(rack, parentId);
      const rackId = newRackId(rack, name, id);
      watch.check(() =>
        rack.addRack({ ...newTree(rackId, parentId), name }, parentId),
      );
      for (const label of inputs) {
        watch.check(() => rack.addJack(rackId, "in", label));
      }
      for (const label of outputs) {
        watch.check(() => rack.addJack(rackId, "out", label));
      }
      return [
        `Added group [${rackId}] ${name} in ${parentId}.`,
        describeNew(store, rackId),
      ].join("\n");
    },
  }),
  defineTool({
    name: "move_rack",
    label: "Moving a rack",
    description:
      "Moves a rack into another tree. Patches that can't reach across its new place are dropped.",
    parameters: Type.Object({
      rackId: Type.String(),
      parent: Type.String({ description: "The tree to move it into." }),
    }),
    run: ({ rackId, parent }) => {
      const { rack } = store.getState();
      notRoot(rack, rackId);
      treeOf(rack, parent);
      const before = patchIds(rack);
      watch.check(() => rack.moveRack(rackId, parent));
      const gone = dropped(before, patchIds(store.getState().rack));
      return `Moved ${rackId} into ${parent}.${
        gone.length === 0
          ? ""
          : ` Dropped ${gone.length} patch(es) that could no longer reach: ${gone.join(", ")}.`
      }`;
    },
  }),
  defineTool({
    name: "remove_racks",
    label: "Removing racks",
    description:
      "Removes racks, with everything inside a tree and every patch to them.",
    parameters: Type.Object({ rackIds: Type.Array(Type.String()) }),
    run: ({ rackIds }) => {
      const { rack } = store.getState();
      for (const id of rackIds) notRoot(rack, id);
      const before = Object.keys(rack.racks).length;
      watch.check(() => rack.removeRacks(rackIds));
      const count = before - Object.keys(store.getState().rack.racks).length;
      return `Removed ${rackIds.join(", ")}${
        count > rackIds.length
          ? ` and ${count - rackIds.length} rack(s) inside them`
          : ""
      }.`;
    },
  }),
  defineTool({
    name: "clear_rack",
    label: "Clearing the rack",
    description:
      "Takes every rack and patch away, keeping the tempo. Only when the user asks for a clean slate.",
    parameters: Type.Object({}),
    run: () => {
      const { rack } = store.getState();
      const count = Object.keys(rack.racks).length - 1;
      watch.check(() => rack.clear());
      return `Cleared the rack: ${count} rack(s) removed.`;
    },
  }),
  defineTool({
    name: "load_demo",
    label: "Loading a demo",
    description: `Puts one of the demos in place of the current rack. Demos: ${demos
      .map((demo) => `${demo.id} (${demo.tagline})`)
      .join("; ")}.`,
    parameters: Type.Object({ demoId: Type.String() }),
    run: ({ demoId }) => {
      const demo = demos.find((held) => held.id === demoId);
      if (demo === undefined) {
        throw new ToolProblem(
          `There is no demo ${demoId}; there are ${demos.map((held) => held.id).join(", ")}.`,
        );
      }
      const { rack, catalogue } = store.getState();
      const built = demo.build(catalogue.registry);
      watch.check(() => rack.load(built));
      return [
        `Loaded the demo ${demo.name}.`,
        describeRackTree(store.getState().rack),
      ].join("\n");
    },
  }),
];
