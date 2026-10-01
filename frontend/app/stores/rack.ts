import { Effect } from "effect";
import type * as ToneJs from "tone";
import { create } from "zustand";
import {
  makeToneRuntime,
  noopRuntime,
  Tone,
  type ToneRuntime,
} from "../audio-renderer";
import {
  canPatch,
  makeBlock,
  makeDefaultJacks,
  rootRack,
  type AutomationEvent,
  type Jack,
  type Method,
  type MethodCall,
  type Param,
  type ParamGroup,
  type ParamTemplateGroup,
  type ParamValue,
  type Patch,
  type Rack,
  type RackTemplate,
  type TreeBlock,
} from "../types/rack";
import { CATALOGUE, type Catalogue, type CatalogueEntry } from "./catalogue";

export type RackState = {
  readonly blocks: Record<string, Rack>;
  readonly jacks: Record<string, Jack>;
  readonly params: Record<string, Param>;
  readonly methods: Record<string, Method>;
  readonly values: Record<string, ParamValue>;
  readonly automations: Record<string, readonly AutomationEvent[]>;
  readonly calls: readonly MethodCall[];
  readonly patches: Record<string, Patch>;
  readonly rootId: string;
  readonly catalogue: Catalogue;
};

export type RackStore = RackState & {
  // The live Tone.js graph. Each action below that changes the rack tells it
  // what changed, once the store itself has been updated.
  readonly runtime: ToneRuntime;
  readonly addBlock: (blockType: "leaf" | "tree") => string | undefined;
  readonly addCatalogueBlock: (
    category: string,
    entry: string,
  ) => string | undefined;
  readonly connectJacks: (
    fromJackId: string,
    toJackId: string,
  ) => string | undefined;
  readonly canConnectJacks: (fromJackId: string, toJackId: string) => boolean;
  readonly removeBlocks: (blockIds: readonly string[]) => void;
  readonly removePatches: (patchIds: readonly string[]) => void;
  readonly setParamValue: (paramId: string, value: ParamValue) => void;
  readonly addAutomation: (
    paramId: string,
    event: Omit<AutomationEvent, "id">,
  ) => string | undefined;
  readonly removeAutomation: (paramId: string, eventId: string) => void;
  readonly callMethod: (
    methodId: string,
    args: Readonly<Record<string, ParamValue>>,
  ) => string | undefined;
  readonly run: () => void;
  readonly categories: () => string[];
  readonly subCategories: (category: string) => CatalogueEntry[];
};

const normalizeParamGroup = (
  blockId: string,
  group: ParamTemplateGroup,
): { readonly group: ParamGroup; readonly params: Record<string, Param> } => {
  const entries = Object.entries(group.params ?? {}).map(([key, param]) => {
    const id = `${blockId}:param:${param.path.join(".") || key}`;
    return [key, { ...param, id, belongToBlockId: blockId }] as const;
  });
  const childGroups = Object.entries(group.groups ?? {}).map(
    ([key, childGroup]) =>
      [key, normalizeParamGroup(blockId, childGroup)] as const,
  );

  return {
    group: {
      ...(group.name === undefined ? {} : { name: group.name }),
      ...(entries.length === 0
        ? {}
        : {
            paramIds: Object.fromEntries(
              entries.map(([key, param]) => [key, param.id]),
            ),
          }),
      ...(childGroups.length === 0
        ? {}
        : {
            groups: Object.fromEntries(
              childGroups.map(([key, normalized]) => [key, normalized.group]),
            ),
          }),
    },
    params: Object.fromEntries([
      ...entries.map(([, param]) => [param.id, param] as const),
      ...childGroups.flatMap(([, normalized]) =>
        Object.entries(normalized.params),
      ),
    ]),
  };
};

const normalizeTemplate = (
  template: RackTemplate,
  blockId: string,
): {
  readonly jacks: readonly Jack[];
  readonly paramIds: ParamGroup;
  readonly methodIds: readonly string[];
  readonly params: Record<string, Param>;
  readonly methods: Record<string, Method>;
} => {
  const directions = template.jacks ?? ["in", "out"];
  const jacks = makeDefaultJacks(blockId).filter((jack) =>
    directions.includes(jack.direction),
  );
  const normalizedParams = normalizeParamGroup(blockId, template.params);
  const methods = Object.fromEntries(
    Object.entries(template.methods ?? {}).map(([key, method]) => {
      const id = `${blockId}:method:${key}`;
      return [id, { ...method, id, belongToBlockId: blockId }] as const;
    }),
  );

  return {
    jacks,
    paramIds: normalizedParams.group,
    methodIds: Object.keys(methods),
    params: normalizedParams.params,
    methods,
  };
};

const resolvePatch = (
  state: RackState,
  fromJackId: string,
  toJackId: string,
):
  | { readonly root: TreeBlock; readonly from: Jack; readonly to: Jack }
  | undefined => {
  const root = state.blocks[state.rootId];
  const from = state.jacks[fromJackId];
  const to = state.jacks[toJackId];

  if (
    root === undefined ||
    root.type !== "tree" ||
    from === undefined ||
    to === undefined ||
    !canPatch(root, from, to)
  ) {
    return undefined;
  }

  return { root, from, to };
};

// A value is only kept when it fits the param it is for: the right type, a
// number clamped into range, a select value that is one of its options.
const acceptValue = (
  param: Param | undefined,
  value: ParamValue,
): ParamValue | undefined => {
  switch (param?.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
      return Math.min(
        param.max ?? Infinity,
        Math.max(param.min ?? -Infinity, value),
      );
    }
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "text":
      return typeof value === "string" ? value : undefined;
    case "select":
      return param.options.some((option) => option.value === value)
        ? value
        : undefined;
    default:
      return undefined;
  }
};

// Seconds, a musical length like 4n, 8t or 1m, or bars:beats:sixteenths,
// optionally after a "+". The same shapes Tone reads as a time from now.
const TIME =
  /^\+?(?:(?:\d+\.?\d*|\.\d+)(?:n\.?|t|m|s|i|hz)?|\d+:\d+(?::\d+(?:\.\d+)?)?)$/;
const isTime = (time: string) => TIME.test(time.trim());

// Tone, once it has loaded. See `run` for why it is kept.
let toneModule: typeof ToneJs | undefined;
// Loaded on demand rather than imported, so the server never imports Tone.
export const loadTone = async () => (toneModule ??= await import("tone"));

// Each Run waits for the one before it, so two quick ones cannot both build a
// runtime, or render over each other.
let running: Promise<void> = Promise.resolve();

// A failure in the audio graph is the renderer's to report, not a reason to
// undo the edit, so the store only logs it.
const perform = (effect: Effect.Effect<void, unknown>) => {
  Effect.runPromise(effect).catch((error) => console.warn(error));
};

export const initialRackState: RackState = {
  blocks: { [rootRack.id]: rootRack },
  jacks: {},
  params: {},
  methods: {},
  values: {},
  automations: {},
  calls: [],
  patches: {},
  rootId: rootRack.id,
  catalogue: CATALOGUE,
};

export const useRackStore = create<RackStore>()((set, get) => ({
  ...initialRackState,
  runtime: noopRuntime,

  addBlock: (blockType) => {
    const { blocks, rootId } = get();
    const root = blocks[rootId];

    if (root === undefined || root.type !== "tree") return undefined;

    const block = makeBlock(crypto.randomUUID(), root.id, blockType);
    const jacks = makeDefaultJacks(block.id);

    set((state) => ({
      blocks: {
        ...state.blocks,
        [root.id]: { ...root, children: [...root.children, block.id] },
        [block.id]: block,
      },
      jacks: {
        ...state.jacks,
        ...Object.fromEntries(jacks.map((jack) => [jack.id, jack])),
      },
    }));
    perform(get().runtime.addBlock(block.id));

    return block.id;
  },

  addCatalogueBlock: (category, entry) => {
    const { blocks, catalogue, rootId } = get();
    const root = blocks[rootId];
    const template = catalogue[category]?.[entry]?.rack;

    if (root === undefined || root.type !== "tree" || template === undefined) {
      return undefined;
    }

    const id = crypto.randomUUID();
    const normalized = normalizeTemplate(template, id);
    const shared = {
      id,
      name: template.name,
      isRoot: false,
      parentId: root.id,
      jackIds: normalized.jacks.map((jack) => jack.id),
      paramIds: normalized.paramIds,
      methodIds: normalized.methodIds,
    };
    const block: Rack =
      template.type === "tree"
        ? { ...shared, type: "tree", children: [], patches: [] }
        : { ...shared, type: "leaf", code: template.code };

    set((state) => ({
      blocks: {
        ...state.blocks,
        [root.id]: { ...root, children: [...root.children, block.id] },
        [block.id]: block,
      },
      jacks: {
        ...state.jacks,
        ...Object.fromEntries(normalized.jacks.map((jack) => [jack.id, jack])),
      },
      params: { ...state.params, ...normalized.params },
      methods: { ...state.methods, ...normalized.methods },
      values: {
        ...state.values,
        ...Object.fromEntries(
          Object.values(normalized.params).map((param) => [
            param.id,
            param.defaultValue,
          ]),
        ),
      },
    }));
    perform(get().runtime.addBlock(block.id));

    return block.id;
  },

  categories: () => Object.keys(get().catalogue),

  subCategories: (category) => Object.values(get().catalogue[category] ?? {}),

  canConnectJacks: (fromJackId, toJackId) =>
    resolvePatch(get(), fromJackId, toJackId) !== undefined,

  connectJacks: (fromJackId, toJackId) => {
    const state = get();
    const resolved = resolvePatch(state, fromJackId, toJackId);
    if (resolved === undefined) return undefined;

    const { root, from, to } = resolved;

    // React Flow reports a connection for every drag that lands, so the same
    // pair of jacks can arrive more than once. Two patches between one pair
    // would draw as two edges stacked on the same line, with no way to tell
    // them apart or to remove only one.
    const held = root.patches.find((id) => {
      const patch = state.patches[id];
      return patch?.from === from.id && patch.to === to.id;
    });
    if (held !== undefined) return held;

    const patch: Patch = {
      id: crypto.randomUUID(),
      name: `${from.name} → ${to.name}`,
      from: from.id,
      to: to.id,
    };

    set((state) => ({
      blocks: {
        ...state.blocks,
        [root.id]: { ...root, patches: [...root.patches, patch.id] },
      },
      patches: { ...state.patches, [patch.id]: patch },
    }));
    perform(get().runtime.addPatch(patch.id));

    return patch.id;
  },

  removeBlocks: (blockIds) => {
    const state = get();
    const root = state.blocks[state.rootId];
    if (root === undefined || root.type !== "tree") return;

    const doomed = new Set(blockIds.filter((id) => root.children.includes(id)));
    if (doomed.size === 0) return;

    const cut = new Set(
      root.patches.filter((id) => {
        const patch = state.patches[id];
        return (
          patch !== undefined &&
          [patch.from, patch.to].some((jackId) => {
            const owner = state.jacks[jackId]?.belongToBlockId;
            return owner !== undefined && doomed.has(owner);
          })
        );
      }),
    );

    const without = <T>(
      record: Record<string, T>,
      drop: (id: string, value: T) => boolean,
    ) =>
      Object.fromEntries(
        Object.entries(record).filter(([id, value]) => !drop(id, value)),
      );

    const doomedParam = (paramId: string) => {
      const owner = state.params[paramId]?.belongToBlockId;
      return owner !== undefined && doomed.has(owner);
    };

    set({
      blocks: {
        ...without(state.blocks, (id) => doomed.has(id)),
        [root.id]: {
          ...root,
          children: root.children.filter((id) => !doomed.has(id)),
          patches: root.patches.filter((id) => !cut.has(id)),
        },
      },
      jacks: without(state.jacks, (_, jack) =>
        doomed.has(jack.belongToBlockId),
      ),
      params: without(state.params, (_, param) =>
        doomed.has(param.belongToBlockId),
      ),
      methods: without(state.methods, (_, method) =>
        doomed.has(method.belongToBlockId),
      ),
      values: without(state.values, (id) => doomedParam(id)),
      automations: without(state.automations, (id) => doomedParam(id)),
      calls: state.calls.filter((call) => {
        const owner = state.methods[call.methodId]?.belongToBlockId;
        return owner === undefined || !doomed.has(owner);
      }),
      patches: without(state.patches, (id) => cut.has(id)),
    });
    // Patches first, while both of their ends are still in the graph.
    const { runtime } = get();
    perform(
      Effect.gen(function* () {
        for (const patchId of cut) yield* runtime.deletePatch(patchId);
        for (const blockId of doomed) yield* runtime.deleteBlock(blockId);
      }),
    );
  },

  removePatches: (patchIds) => {
    const state = get();
    const root = state.blocks[state.rootId];
    if (root === undefined || root.type !== "tree") return;

    const cut = new Set(patchIds.filter((id) => root.patches.includes(id)));
    if (cut.size === 0) return;

    set({
      blocks: {
        ...state.blocks,
        [root.id]: {
          ...root,
          patches: root.patches.filter((id) => !cut.has(id)),
        },
      },
      patches: Object.fromEntries(
        Object.entries(state.patches).filter(([id]) => !cut.has(id)),
      ),
    });
    const { runtime } = get();
    perform(Effect.forEach(cut, runtime.deletePatch, { discard: true }));
  },

  setParamValue: (paramId, value) => {
    const param = get().params[paramId];
    const accepted = acceptValue(param, value);
    if (accepted === undefined) return;

    set((state) => ({ values: { ...state.values, [paramId]: accepted } }));
    perform(get().runtime.updateParam(paramId));
  },

  addAutomation: (paramId, event) => {
    const param = get().params[paramId];
    if (
      param?.kind !== "number" ||
      !(param.automation?.methods ?? []).includes(event.method) ||
      !Number.isFinite(event.value) ||
      !isTime(event.time) ||
      (event.rampTime !== undefined && !isTime(event.rampTime))
    ) {
      return undefined;
    }

    const id = crypto.randomUUID();
    set((state) => ({
      automations: {
        ...state.automations,
        [paramId]: [...(state.automations[paramId] ?? []), { ...event, id }],
      },
    }));
    perform(get().runtime.updateParam(paramId));

    return id;
  },

  removeAutomation: (paramId, eventId) => {
    set((state) => ({
      automations: {
        ...state.automations,
        [paramId]: (state.automations[paramId] ?? []).filter(
          (event) => event.id !== eventId,
        ),
      },
    }));
    perform(get().runtime.updateParam(paramId));
  },

  callMethod: (methodId, args) => {
    const method = get().methods[methodId];
    if (method === undefined) return undefined;

    // An argument left blank is dropped rather than sent as an empty string,
    // so the method falls back to its own default for it.
    const given = Object.fromEntries(
      Object.entries(args).filter(([, value]) => value !== ""),
    );
    const missing = method.args.some(
      (arg) => arg.optional !== true && given[arg.name] === undefined,
    );
    if (missing) return undefined;

    const call: MethodCall = { id: crypto.randomUUID(), methodId, args: given };
    set((state) => ({ calls: [...state.calls, call] }));
    perform(get().runtime.runLeafMethod(methodId, given));

    return call.id;
  },

  // Starts audio and builds the rack's Tone.js graph, rebuilding it from
  // scratch if it is already running. Browsers only let audio start from a
  // user gesture, which the Run button, menu item and R shortcut all are.
  // Safari counts the gesture as over once anything is awaited, so when Tone
  // has already loaded (the canvas loads it up front) audio starts right here.
  run: () => {
    const started = toneModule?.start();

    running = running
      .then(async () => {
        const tone = await loadTone();
        await (started ?? tone.start());

        if (get().runtime === noopRuntime) {
          const runtime = await Effect.runPromise(
            makeToneRuntime(get).pipe(Effect.provideService(Tone, tone)),
          );
          set({ runtime });
        }
        await Effect.runPromise(get().runtime.render);
      })
      .catch((error) => console.warn(error));
  },
}));
