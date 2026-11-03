import { specParams } from "./instantiate";
import {
  decodeItem,
  decodePluginHeader,
  type Category,
  type ItemSpec,
  type PluginSpec,
} from "./spec";

// Every plugin loaded, and every item they hold under `pluginId/name`. Plain
// data, so the store can hold it and a plugin can be loaded from JSON.

export type CatalogueEntry = ItemSpec & {
  readonly key: string;
  readonly plugin: string;
};

export type LoadError = {
  readonly plugin: string;
  readonly item?: string;
  readonly message: string;
};

export type Registry = {
  readonly plugins: Readonly<Record<string, PluginSpec>>;
  readonly items: Readonly<Record<string, CatalogueEntry>>;
  readonly errors: readonly LoadError[];
};

export const emptyRegistry: Registry = { plugins: {}, items: {}, errors: [] };

export const itemKey = (plugin: string, name: string) => `${plugin}/${name}`;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const duplicates = (values: readonly string[]) =>
  values.filter((value, index) => values.indexOf(value) !== index);

// What the schema can't see: how an item's parts refer to each other, and
// which ids instantiating it would give twice.
export const itemProblems = (item: ItemSpec): string[] => {
  const problems: string[] = [];
  const params = specParams(item.params);
  const methods = (item.methods ?? []).map((method) => method.method);
  const jacks = item.jacks ?? [];

  for (const path of duplicates(params.map((param) => param.path.join(".")))) {
    problems.push(`two params have the path ${path}`);
  }
  for (const method of duplicates(methods)) {
    problems.push(`two methods call ${method}`);
  }
  for (const event of item.events ?? []) {
    if (!methods.includes(event.method)) {
      problems.push(
        `an event calls ${event.method}, which it has no method for`,
      );
    }
  }
  for (const param of params) {
    if (param.patchable === true && param.kind !== "number") {
      problems.push(`${param.name} is patchable but not a number`);
    }
  }
  for (const direction of ["in", "out"] as const) {
    const held = jacks.filter((jack) => jack.direction === direction);
    if (held.length < 2) continue;
    if (held.some((jack) => jack.key === undefined)) {
      problems.push(`every ${direction} jack needs a key when there are two`);
    }
    for (const key of duplicates(held.flatMap((jack) => jack.key ?? []))) {
      problems.push(`two ${direction} jacks have the key ${key}`);
    }
  }
  for (const jack of jacks) {
    if (jack.port?.member?.length === 0) {
      problems.push(`${jack.key ?? jack.direction} jack has an empty member`);
    }
  }
  return problems;
};

export const unloadPlugin = (
  registry: Registry,
  pluginId: string,
): Registry => {
  const { [pluginId]: _, ...plugins } = registry.plugins;
  return {
    plugins,
    items: Object.fromEntries(
      Object.entries(registry.items).filter(
        ([, item]) => item.plugin !== pluginId,
      ),
    ),
    errors: registry.errors.filter((error) => error.plugin !== pluginId),
  };
};

// Loads a plugin, replacing any with its id. An item that doesn't decode or
// doesn't hold together is left out and reported; the rest still load.
export const loadPlugin = (registry: Registry, input: unknown): Registry => {
  let header;
  try {
    header = decodePluginHeader(input);
  } catch (error) {
    const id =
      typeof input === "object" && input !== null && "id" in input
        ? String(input.id)
        : "unknown";
    return {
      ...registry,
      errors: [...registry.errors, { plugin: id, message: messageOf(error) }],
    };
  }

  const base = unloadPlugin(registry, header.id);
  const errors: LoadError[] = [];
  const items: ItemSpec[] = [];
  header.items.forEach((raw, index) => {
    const label =
      typeof raw === "object" && raw !== null && "name" in raw
        ? String(raw.name)
        : `item ${index}`;
    let item: ItemSpec;
    try {
      item = decodeItem(raw);
    } catch (error) {
      errors.push({
        plugin: header.id,
        item: label,
        message: messageOf(error),
      });
      return;
    }
    const problems = itemProblems(item);
    if (items.some((held) => held.name === item.name)) {
      problems.push(`another item is named ${item.name}`);
    }
    if (problems.length > 0) {
      errors.push({
        plugin: header.id,
        item: label,
        message: problems.join("; "),
      });
      return;
    }
    items.push(item);
  });

  const entries = items.map((item): CatalogueEntry => ({
    ...item,
    key: itemKey(header.id, item.name),
    plugin: header.id,
  }));
  return {
    plugins: { ...base.plugins, [header.id]: { ...header, items } },
    items: {
      ...base.items,
      ...Object.fromEntries(entries.map((entry) => [entry.key, entry])),
    },
    errors: [...base.errors, ...errors],
  };
};

// A category's items in the order their plugins were loaded.
export const itemsIn = (
  registry: Registry,
  category: Category,
): CatalogueEntry[] =>
  Object.values(registry.items).filter((item) => item.category === category);
