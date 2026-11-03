import type { CatalogueEntry, Registry } from "../../catalogue";
import {
  findParam,
  type Jack,
  type LeafRack,
  type Method,
  type Param,
  type Patch,
  type Rack,
  type RackEvent,
  type RackState,
  type TreeRack,
} from "../../rack";
import { ToolProblem } from "./tool";

// Finds what a tool is asked to act on, or says what is missing in a way the
// model can recover from.

const hint = "Call read_rack to see what there is.";

export const rackOf = (state: RackState, id: string): Rack => {
  const rack = state.racks[id];
  if (rack === undefined)
    throw new ToolProblem(`There is no rack ${id}. ${hint}`);
  return rack;
};

export const treeOf = (state: RackState, id: string): TreeRack => {
  const rack = rackOf(state, id);
  if (rack.type !== "tree") {
    throw new ToolProblem(
      `${id} is a leaf, not a tree (group), so nothing can go inside it.`,
    );
  }
  return rack;
};

export const leafOf = (state: RackState, id: string): LeafRack => {
  const rack = rackOf(state, id);
  if (rack.type !== "leaf") {
    throw new ToolProblem(`${id} is a tree (group), not a leaf.`);
  }
  return rack;
};

export const notRoot = (state: RackState, id: string): Rack => {
  const rack = rackOf(state, id);
  if (rack.isRoot) throw new ToolProblem("The root rack stays as it is.");
  return rack;
};

export const jackOf = (state: RackState, id: string): Jack => {
  const jack = state.jacks[id];
  if (jack === undefined) {
    throw new ToolProblem(
      `There is no jack ${id}. Jacks are named like rack:in, rack:out, rack:in:key or rack:mod:param. ${hint}`,
    );
  }
  return jack;
};

export const paramOf = (state: RackState, id: string): Param => {
  const param = findParam(state, id);
  if (param === undefined) {
    throw new ToolProblem(
      `There is no param ${id}. Params are named like rack:param:path. Call read_rack with the rack's id to see them.`,
    );
  }
  return param;
};

export const methodOf = (state: RackState, id: string): Method => {
  const method = state.methods[id];
  if (method === undefined) {
    throw new ToolProblem(
      `There is no method ${id}. Methods are named like rack:method:name. Call read_rack with the rack's id to see them.`,
    );
  }
  return method;
};

export const eventOf = (state: RackState, id: string): RackEvent => {
  const event = state.events[id];
  if (event === undefined) {
    throw new ToolProblem(`There is no event ${id}. ${hint}`);
  }
  return event;
};

export const patchOf = (state: RackState, id: string): Patch => {
  const patch = state.patches[id];
  if (patch === undefined) {
    throw new ToolProblem(`There is no patch ${id}. ${hint}`);
  }
  return patch;
};

// An item by its key, or failing that by its name alone; otherwise a few
// that come close.
export const resolveItem = (
  registry: Registry,
  key: string,
): CatalogueEntry => {
  const exact = registry.items[key];
  if (exact !== undefined) return exact;
  const wanted = key.toLowerCase();
  const items = Object.values(registry.items);
  const byName = items.filter(
    (item) =>
      item.key.toLowerCase() === wanted || item.name.toLowerCase() === wanted,
  );
  if (byName.length === 1) return byName[0]!;
  const close = items
    .filter((item) => item.key.toLowerCase().includes(wanted))
    .map((item) => item.key)
    .slice(0, 6);
  throw new ToolProblem(
    `${key} is not in the catalogue.${
      close.length === 0
        ? " Call read_catalogue to search it."
        : ` Did you mean ${close.join(", ")}?`
    }`,
  );
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "rack";

// An id for a new rack: the one asked for, if it is free and will not clash
// with how jacks and params are named under it, or one made from a name.
export const newRackId = (
  state: RackState,
  name: string,
  wanted?: string,
): string => {
  if (wanted !== undefined) {
    if (/[\s:]/.test(wanted) || wanted === "") {
      throw new ToolProblem(
        `${JSON.stringify(wanted)} can't be a rack id: use letters, digits, dots and dashes, with no spaces or colons.`,
      );
    }
    if (state.racks[wanted] !== undefined) {
      throw new ToolProblem(`There is already a rack ${wanted}.`);
    }
    return wanted;
  }
  const base = slug(name);
  let id = base;
  for (let n = 2; state.racks[id] !== undefined; n += 1) id = `${base}-${n}`;
  return id;
};
