import {
  categories,
  specParams,
  type CatalogueEntry,
  type Category,
  type ItemSpec,
  type JackSpec,
  type MethodSpec,
  type ParamSpec,
  type ParamSpecGroup,
  type Registry,
} from "../../catalogue";
import {
  flattenParams,
  paramDrivers,
  rackParams,
  type AutomationEvent,
  type Jack,
  type Method,
  type MethodArg,
  type Param,
  type ParamGroup,
  type Patch,
  type Rack,
  type RackEvent,
  type RackState,
} from "../../rack";

// The rack and the catalogue as text the agent reads: compact, with every id
// it would need to act on, and the leaf code left out unless asked for.

export type RackSnapshot = RackState & { readonly errors: readonly string[] };

const quote = (value: unknown) => JSON.stringify(value);

const indent = (lines: readonly string[], depth = 1) =>
  lines.map((line) => `${"  ".repeat(depth)}${line}`);

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const signature = (name: string, args: readonly MethodArg[]) =>
  `${name}(${args
    .map(
      (arg) =>
        `${arg.name}${arg.optional === true ? "?" : ""}: ${arg.kind}${
          arg.defaultValue === undefined ? "" : ` = ${quote(arg.defaultValue)}`
        }`,
    )
    .join(", ")})`;

const argHelp = (args: readonly MethodArg[]) =>
  args.flatMap((arg) =>
    arg.description === undefined ? [] : [`${arg.name}: ${arg.description}`],
  );

// What a number param allows, in a few words.
const numberRange = (param: {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}) =>
  [
    param.min !== undefined || param.max !== undefined
      ? `${param.min ?? "…"}..${param.max ?? "…"}`
      : undefined,
    param.step === undefined ? undefined : `step ${param.step}`,
    param.unit,
  ]
    .filter((part) => part !== undefined)
    .join(" ");

const paramKind = (param: Param | ParamSpec) => {
  switch (param.kind) {
    case "number": {
      const range = numberRange(param);
      const automation =
        param.automation === undefined
          ? ""
          : `, automation: ${param.automation.methods.join(", ")}`;
      return `number${range === "" ? "" : ` ${range}`}${automation}`;
    }
    case "boolean":
      return "true or false";
    case "text":
      return "text";
    case "select":
      return `one of ${param.options.map((option) => quote(option.value)).join(", ")}`;
  }
};

const eventLine = (event: RackEvent) => {
  const common = [
    event.mute ? "muted" : undefined,
    Object.keys(event.args).length === 0
      ? undefined
      : `args ${quote(event.args)}`,
    event.probability === undefined
      ? undefined
      : `probability ${event.probability}`,
    event.humanize === undefined ? undefined : `humanize ${event.humanize}`,
    event.playbackRate === undefined
      ? undefined
      : `playbackRate ${event.playbackRate}`,
  ].filter((part) => part !== undefined);
  const own = (() => {
    switch (event.kind) {
      case "sequence":
        return `sequence every ${event.subdivision}: ${event.steps
          .map((step) => (step === null ? "_" : String(step)))
          .join(" ")}`;
      case "event":
        return `loop${event.value === undefined ? "" : ` ${quote(event.value)}`} from ${event.start}, loop ${event.loop}${
          event.loopEnd === undefined ? "" : ` every ${event.loopEnd}`
        }`;
      case "pattern":
        return `pattern ${event.pattern} every ${event.interval}: ${event.values.join(" ")}`;
      case "part":
        return `part${event.loopEnd === undefined ? "" : ` looping every ${event.loopEnd}`}: ${event.steps
          .map((step) => `${step.time} ${step.value ?? "_"}`)
          .join(", ")}`;
    }
  })();
  return `[${event.id}] ${own} on ${event.methodId}${
    common.length === 0 ? "" : ` (${common.join(", ")})`
  }`;
};

const automationLine = (event: AutomationEvent) =>
  `[${event.id}] ${event.method} ${event.value} at ${event.time}${
    event.rampTime === undefined ? "" : ` over ${event.rampTime}`
  }`;

const patchLine = (patch: Patch) =>
  `[${patch.id}] ${patch.from} -> ${patch.to}`;

const jackSummary = (state: RackSnapshot, rack: Rack) => {
  const jacks = rack.jackIds.flatMap((id) => state.jacks[id] ?? []);
  const ids = (direction: Jack["direction"]) =>
    jacks
      .filter(
        (jack) =>
          jack.direction === direction && jack.port?.member === undefined,
      )
      .map((jack) => jack.id);
  const mods = jacks.filter(
    (jack) => jack.direction === "in" && jack.port?.member !== undefined,
  );
  return [
    ids("in").length === 0 ? undefined : `in: ${ids("in").join(", ")}`,
    mods.length === 0
      ? undefined
      : `mod: ${mods.map((jack) => jack.id).join(", ")}`,
    ids("out").length === 0 ? undefined : `out: ${ids("out").join(", ")}`,
  ].filter((part) => part !== undefined);
};

const rackKind = (rack: Rack) =>
  rack.type === "tree"
    ? "tree"
    : rack.item === undefined
      ? "leaf, own code"
      : rack.item;

// One line per rack, nested under the tree that holds it.
const treeLines = (state: RackSnapshot, rackId: string): string[] => {
  const rack = state.racks[rackId];
  if (rack === undefined) return [];
  const parts = [
    `[${rack.id}] ${rack.name} (${rackKind(rack)})`,
    ...jackSummary(state, rack),
  ];
  if (rack.type === "leaf") {
    const params = rackParams(state, rack.id).length;
    if (params > 0) parts.push(plural(params, "param"));
    if (rack.methodIds.length > 0) {
      parts.push(plural(rack.methodIds.length, "method"));
    }
    if (rack.eventIds.length > 0) {
      parts.push(plural(rack.eventIds.length, "event"));
    }
    return [parts.join(" · ")];
  }
  return [
    parts.join(" · "),
    ...indent(rack.children.flatMap((child) => treeLines(state, child))),
  ];
};

const transportLine = (state: RackSnapshot) =>
  `Transport: ${state.transport.bpm} bpm, ${state.transport.playing ? "playing" : "stopped"}.`;

const errorLines = (errors: readonly string[]) => {
  if (errors.length === 0) return ["No errors reported."];
  const recent = errors.slice(-8);
  return [
    `Errors reported (last ${recent.length} of ${errors.length}):`,
    ...indent(recent.map((error) => `- ${error}`)),
  ];
};

export const describeRackTree = (state: RackSnapshot): string => {
  const patches = Object.values(state.patches);
  return [
    transportLine(state),
    "Racks, as [id] name (what it is), nested under the tree that holds them:",
    ...indent(treeLines(state, state.rootId)),
    patches.length === 0 ? "No patches." : "Patches, as [id] from -> to:",
    ...indent(patches.map(patchLine)),
    ...errorLines(state.errors),
  ].join("\n");
};

const paramLines = (
  state: RackSnapshot,
  group: ParamGroup,
  section?: string,
): string[] => {
  const own = (group.params ?? []).map((param) => {
    const value = state.values[param.id];
    const drivers = paramDrivers(state, param.id);
    return [
      `${param.id}: ${quote(value)} — ${param.name}, ${paramKind(param)}`,
      section === undefined ? undefined : `[${section}]`,
      drivers.length === 0 ? undefined : `driven by ${drivers.join(", ")}`,
      param.description,
    ]
      .filter((part) => part !== undefined)
      .join(" · ");
  });
  const nested = Object.entries(group.groups ?? {}).flatMap(([key, held]) =>
    paramLines(state, held, held.name ?? key),
  );
  return [...own, ...nested];
};

// Everything about one rack, with the ids its parts go by.
export const describeOneRack = (
  state: RackSnapshot,
  rackId: string,
  { withCode = false }: { readonly withCode?: boolean } = {},
): string | undefined => {
  const rack = state.racks[rackId];
  if (rack === undefined) return undefined;
  const lines = [
    `[${rack.id}] ${rack.name} — ${rackKind(rack)}${
      rack.parentId === undefined ? ", the root" : `, in ${rack.parentId}`
    }`,
  ];

  const jacks = rack.jackIds.flatMap((id) => state.jacks[id] ?? []);
  lines.push(
    jacks.length === 0 ? "No jacks." : "Jacks:",
    ...indent(
      jacks.map((jack) => {
        const port =
          jack.port?.member !== undefined
            ? `, drives param ${jack.belongToBlockId}:param:${jack.port.member.join(".")}`
            : jack.port?.index !== undefined
              ? `, port ${jack.port.index}`
              : "";
        return `${jack.id} (${jack.direction}) ${jack.name}${port}`;
      }),
    ),
  );

  if (rack.type === "tree") {
    lines.push(
      rack.children.length === 0
        ? "Holds no racks."
        : `Holds: ${rack.children.join(", ")}`,
    );
    const patches = rack.patches.flatMap((id) => state.patches[id] ?? []);
    if (patches.length > 0) {
      lines.push("Patches inside it:", ...indent(patches.map(patchLine)));
    }
    return lines.join("\n");
  }

  const group =
    rack.paramGroupId === undefined
      ? undefined
      : state.paramGroups[rack.paramGroupId];
  const params = group === undefined ? [] : flattenParams(group);
  lines.push(
    params.length === 0
      ? "No params."
      : "Params, as id: value — name, what it takes:",
    ...(group === undefined ? [] : indent(paramLines(state, group))),
  );

  const methods = rack.methodIds.flatMap((id) => state.methods[id] ?? []);
  lines.push(
    methods.length === 0 ? "No methods." : "Methods, as id: signature:",
    ...indent(
      methods.flatMap((method: Method) => [
        `${method.id}: ${signature(method.method, method.args)}${
          method.description === undefined ? "" : ` — ${method.description}`
        }`,
        ...indent(argHelp(method.args)),
      ]),
    ),
  );

  const events = rack.eventIds.flatMap((id) => state.events[id] ?? []);
  lines.push(
    events.length === 0 ? "No events." : "Events:",
    ...indent(events.map(eventLine)),
  );

  const automated = params.flatMap((param) => {
    const held = state.automations[param.id] ?? [];
    return held.length === 0
      ? []
      : [`${param.id}:`, ...indent(held.map(automationLine))];
  });
  if (automated.length > 0) lines.push("Automations:", ...indent(automated));

  const patches = Object.values(state.patches).filter((patch) =>
    [patch.from, patch.to].some((id) => rack.jackIds.includes(id)),
  );
  if (patches.length > 0)
    lines.push("Patches:", ...indent(patches.map(patchLine)));

  if (rack.readout !== undefined) lines.push(`Readout: ${rack.readout.kind}`);
  if (withCode) lines.push("Code:", rack.code);
  return lines.join("\n");
};

const specJacks = (item: ItemSpec): readonly JackSpec[] =>
  item.jacks ?? [{ direction: "in" }, { direction: "out" }];

const jackSpecLine = (jack: JackSpec) => {
  const port =
    jack.port?.member !== undefined
      ? ` on member ${jack.port.member.join(".")}`
      : jack.port?.index !== undefined
        ? ` on port ${jack.port.index}`
        : "";
  return `${jack.direction}${jack.key === undefined ? "" : ` key ${jack.key}`}${
    jack.name === undefined ? "" : ` "${jack.name}"`
  }${port}`;
};

const itemLine = (item: CatalogueEntry) => {
  const jacks = specJacks(item);
  const count = (direction: JackSpec["direction"]) =>
    jacks.filter((jack) => jack.direction === direction).length;
  const patchable = specParams(item.params).filter(
    (param) => param.patchable === true,
  ).length;
  const ports = [
    `${count("in")} in`,
    patchable === 0 ? undefined : `${patchable} patchable`,
    `${count("out")} out`,
  ].filter((part) => part !== undefined);
  return `${item.key} — ${item.description} (${ports.join(", ")})`;
};

const matches = (item: CatalogueEntry, query: string) => {
  const haystack =
    `${item.key} ${item.name} ${item.category} ${item.description}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => haystack.includes(word));
};

export const describeCatalogue = (
  registry: Registry,
  {
    query,
    category,
  }: { readonly query?: string; readonly category?: Category } = {},
): string => {
  const wanted = categories.filter(
    (held) => category === undefined || held === category,
  );
  const sections = wanted.flatMap((held) => {
    const items = Object.values(registry.items).filter(
      (item) =>
        item.category === held && (query === undefined || matches(item, query)),
    );
    return items.length === 0
      ? []
      : [`${held} (${items.length}):`, ...indent(items.map(itemLine))];
  });
  if (sections.length === 0) {
    return `Nothing in the catalogue matches${
      query === undefined ? "" : ` "${query}"`
    }${category === undefined ? "" : ` in ${category}`}.`;
  }
  const plugins = Object.values(registry.plugins)
    .map((plugin) => `${plugin.id} (${plugin.name} ${plugin.version})`)
    .join(", ");
  return [`Plugins loaded: ${plugins}.`, ...sections].join("\n");
};

const specParamLines = (group: ParamSpecGroup, section?: string): string[] => {
  const own = (group.params ?? []).map((param) =>
    [
      `${param.path.join(".")}: ${paramKind(param)}, default ${quote(param.defaultValue)}`,
      `"${param.name}"`,
      section === undefined ? undefined : `[${section}]`,
      param.patchable === true ? "patchable" : undefined,
      param.description,
    ]
      .filter((part) => part !== undefined)
      .join(" · "),
  );
  const nested = Object.entries(group.groups ?? {}).flatMap(([key, held]) =>
    specParamLines(held, held.name ?? key),
  );
  return [...own, ...nested];
};

// One item in full, for placing it or writing one like it.
export const describeItem = (
  item: ItemSpec & { readonly key?: string; readonly plugin?: string },
  { withCode = false }: { readonly withCode?: boolean } = {},
): string => {
  const lines = [
    `${item.key ?? item.name} — ${item.category}${
      item.plugin === undefined ? "" : `, from plugin ${item.plugin}`
    }`,
    item.description,
    `Jacks: ${specJacks(item).map(jackSpecLine).join("; ")}`,
  ];
  const params = specParamLines(item.params ?? {});
  lines.push(
    params.length === 0 ? "No params." : "Params, as path: what it takes:",
    ...indent(params),
  );
  const methods = item.methods ?? [];
  lines.push(
    methods.length === 0 ? "No methods." : "Methods:",
    ...indent(
      methods.flatMap((method: MethodSpec) => [
        `${signature(method.method, method.args)}${
          method.description === undefined ? "" : ` — ${method.description}`
        }`,
        ...indent(argHelp(method.args)),
      ]),
    ),
  );
  const events = item.events ?? [];
  if (events.length > 0) {
    lines.push(
      `Events it arrives with: ${events
        .map((event) => `${event.kind} on ${event.method}`)
        .join(", ")}`,
    );
  }
  if (item.readout !== undefined) lines.push(`Readout: ${item.readout.kind}`);
  if (withCode) lines.push("Code:", item.code);
  return lines.join("\n");
};
