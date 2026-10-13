import type { StoreApi } from "zustand";
import type { ActionResult, RackAction } from "../agent";
import { CATALOGUE } from "../catalogue";
import type {
  Jack,
  Param,
  ParamTemplateGroup,
  Rack,
  RackState,
  RackStore,
  TreeBlock,
} from "../rack";

// Makes the changes the agent asks for. The agent only ever sends a
// RackAction out; this is what turns one into store calls, and what tells
// the agent, and the chat, what came of it. Every result's text is a
// sentence; `data` carries the ids the agent needs next.

type Store = StoreApi<RackStore>;

const ok = (text: string, data?: unknown): ActionResult =>
  data === undefined ? { ok: true, text } : { ok: true, text, data };
const refuse = (text: string, data?: unknown): ActionResult =>
  data === undefined ? { ok: false, text } : { ok: false, text, data };

const root = (state: RackState): TreeBlock | undefined => {
  const block = state.blocks[state.rootId];
  return block?.type === "tree" ? block : undefined;
};

// Only the root's own children; the canvas shows no deeper.
const childBlocks = (state: RackState): Rack[] =>
  (root(state)?.children ?? []).flatMap((id) => {
    const block = state.blocks[id];
    return block === undefined ? [] : [block];
  });

const jackOf = (
  state: RackState,
  block: Rack,
  direction: Jack["direction"],
): Jack | undefined =>
  block.jackIds
    .map((id) => state.jacks[id])
    .find((jack) => jack?.direction === direction);

const owner = (state: RackState, jackId: string): string | undefined => {
  const blockId = state.jacks[jackId]?.belongToBlockId;
  return blockId === undefined ? undefined : state.blocks[blockId]?.name;
};

// The param names a template's block will have, after `<block id>:param:`.
const templateParams = (group: ParamTemplateGroup): string[] => [
  ...Object.values(group.params ?? {}).map((param) => param.path.join(".")),
  ...Object.values(group.groups ?? {}).flatMap(templateParams),
];

const catalogueEntries = () =>
  Object.entries(CATALOGUE).flatMap(([category, entries]) =>
    Object.entries(entries).map(([entry, { rack }]) => ({
      category,
      entry,
      params: templateParams(rack.params),
    })),
  );

const paramSummary = (state: RackState, param: Param) => ({
  id: param.id,
  name: param.name,
  kind: param.kind,
  value: state.values[param.id],
  ...(param.description === undefined
    ? {}
    : { description: param.description }),
  ...(param.kind === "number"
    ? {
        ...(param.min === undefined ? {} : { min: param.min }),
        ...(param.max === undefined ? {} : { max: param.max }),
        ...(param.step === undefined ? {} : { step: param.step }),
        ...(param.unit === undefined ? {} : { unit: param.unit }),
      }
    : {}),
  ...(param.kind === "select"
    ? { options: param.options.map((option) => option.value) }
    : {}),
});

const blockSummary = (state: RackState, block: Rack) => ({
  id: block.id,
  name: block.name,
  ...(jackOf(state, block, "in") === undefined ? {} : { hasInput: true }),
  ...(jackOf(state, block, "out") === undefined ? {} : { hasOutput: true }),
  params: Object.values(state.params)
    .filter((param) => param.belongToBlockId === block.id)
    .map((param) => paramSummary(state, param)),
  methods: block.methodIds.flatMap((id) => {
    const method = state.methods[id];
    return method === undefined
      ? []
      : [{ id, name: method.name, args: method.args }];
  }),
  events: block.eventIds.flatMap((id) => {
    const event = state.events[id];
    return event === undefined
      ? []
      : [{ id, kind: event.kind, methodId: event.methodId, mute: event.mute }];
  }),
});

const patchSummary = (state: RackState, patchId: string) => {
  const patch = state.patches[patchId];
  if (patch === undefined) return [];
  return [
    {
      id: patch.id,
      from: state.jacks[patch.from]?.belongToBlockId,
      to: state.jacks[patch.to]?.belongToBlockId,
    },
  ];
};

// The rack as the agent sees it, with the ids its other actions take.
export const describeRack = (state: RackState) => ({
  catalogue: catalogueEntries(),
  transport: state.transport,
  blocks: childBlocks(state).map((block) => blockSummary(state, block)),
  patches: (root(state)?.patches ?? []).flatMap((id) =>
    patchSummary(state, id),
  ),
});

const describe = (store: Store): ActionResult => {
  const summary = describeRack(store.getState());
  const blocks = summary.blocks.length;
  const patches = summary.patches.length;
  return ok(
    `Looked at the rack: ${blocks} ${blocks === 1 ? "block" : "blocks"}, ${patches} ${patches === 1 ? "patch" : "patches"}.`,
    summary,
  );
};

const addBlock = (
  store: Store,
  { id, category, entry }: Extract<RackAction, { kind: "add_block" }>,
): ActionResult => {
  const template = CATALOGUE[category]?.[entry]?.rack;
  if (template === undefined) {
    return refuse(`There is no ${category}/${entry} in the catalogue.`, {
      catalogue: catalogueEntries(),
    });
  }
  if (id in store.getState().blocks)
    return refuse(`There is already a block with id ${id}.`);
  const added = store.getState().addTemplate(template, id);
  const state = store.getState();
  const block = added === undefined ? undefined : state.blocks[added];
  if (block === undefined)
    return refuse(`${template.name} could not be added.`);
  return ok(`Added ${block.name} as ${block.id}.`, blockSummary(state, block));
};

const removeBlocks = (
  store: Store,
  { blockIds }: Extract<RackAction, { kind: "remove_blocks" }>,
): ActionResult => {
  const state = store.getState();
  const known = new Set(childBlocks(state).map((block) => block.id));
  const unknown = blockIds.filter((id) => !known.has(id));
  if (unknown.length > 0)
    return refuse(`There is no block with id ${unknown.join(", ")}.`);

  const names = blockIds.map((id) => state.blocks[id]?.name ?? id);
  state.removeBlocks(blockIds);
  return ok(`Removed ${names.join(", ")}.`);
};

const connectBlocks = (
  store: Store,
  { fromBlockId, toBlockId }: Extract<RackAction, { kind: "connect_blocks" }>,
): ActionResult => {
  const state = store.getState();
  const from = state.blocks[fromBlockId];
  const to = state.blocks[toBlockId];
  if (from === undefined)
    return refuse(`There is no block with id ${fromBlockId}.`);
  if (to === undefined)
    return refuse(`There is no block with id ${toBlockId}.`);

  const out = jackOf(state, from, "out");
  const into = jackOf(state, to, "in");
  if (out === undefined)
    return refuse(`${from.name} has no output to patch from.`);
  if (into === undefined)
    return refuse(`${to.name} has no input to patch into.`);

  const patchId = state.connectJacks(out.id, into.id);
  if (patchId === undefined)
    return refuse(`${from.name} cannot be patched into ${to.name}.`);
  return ok(`Connected ${from.name} to ${to.name}.`, { patchId });
};

const disconnect = (
  store: Store,
  { patchId }: Extract<RackAction, { kind: "disconnect" }>,
): ActionResult => {
  const state = store.getState();
  const patch = state.patches[patchId];
  if (patch === undefined || !root(state)?.patches.includes(patchId))
    return refuse(`There is no patch with id ${patchId}.`);

  const from = owner(state, patch.from) ?? "a block";
  const to = owner(state, patch.to) ?? "a block";
  state.removePatches([patchId]);
  return ok(`Disconnected ${from} from ${to}.`);
};

// What a param takes, for when a value is refused.
const takes = (param: Param): string => {
  switch (param.kind) {
    case "number": {
      const low = param.min === undefined ? undefined : `from ${param.min}`;
      const high = param.max === undefined ? undefined : `to ${param.max}`;
      const range = [low, high].filter((part) => part !== undefined).join(" ");
      return range === "" ? "a number" : `a number ${range}`;
    }
    case "boolean":
      return "true or false";
    case "text":
      return "text";
    case "select":
      return `one of ${param.options.map((option) => String(option.value)).join(", ")}`;
  }
};

const setParam = (
  store: Store,
  { paramId, value }: Extract<RackAction, { kind: "set_param" }>,
): ActionResult => {
  const state = store.getState();
  const param = state.params[paramId];
  if (param === undefined)
    return refuse(`There is no param with id ${paramId}.`);

  const block = state.blocks[param.belongToBlockId];
  const name = block === undefined ? param.name : `${block.name} ${param.name}`;
  if (!state.setParamValue(paramId, value))
    return refuse(`${name} takes ${takes(param)}.`);

  const stored = store.getState().values[paramId];
  const unit =
    param.kind === "number" && param.unit !== undefined ? ` ${param.unit}` : "";
  const clamped = stored === value ? "" : ` (clamped from ${String(value)})`;
  return ok(`Set ${name} to ${String(stored)}${unit}${clamped}.`, {
    paramId,
    value: stored,
  });
};

const setTransport = (
  store: Store,
  { bpm }: Extract<RackAction, { kind: "set_transport" }>,
): ActionResult =>
  store.getState().setTransport({ bpm })
    ? ok(`Set the tempo to ${bpm} bpm.`)
    : refuse("The tempo has to be a number above 0.");

export const applyAction = (store: Store, action: RackAction): ActionResult => {
  switch (action.kind) {
    case "describe":
      return describe(store);
    case "add_block":
      return addBlock(store, action);
    case "remove_blocks":
      return removeBlocks(store, action);
    case "connect_blocks":
      return connectBlocks(store, action);
    case "disconnect":
      return disconnect(store, action);
    case "set_param":
      return setParam(store, action);
    case "set_transport":
      return setTransport(store, action);
  }
};
