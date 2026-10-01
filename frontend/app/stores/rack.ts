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
  isRackEvent,
  makeBlock,
  makeDefaultJacks,
  noteArg,
  rootRack,
  timeArg,
  type AutomationEvent,
  type EventSettings,
  type Jack,
  type Method,
  type Param,
  type ParamGroup,
  type ParamTemplateGroup,
  type ParamValue,
  type Patch,
  type Rack,
  type RackEvent,
  type RackTemplate,
  type Transport,
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
  readonly patches: Record<string, Patch>;
  readonly events: Record<string, RackEvent>;
  readonly transport: Transport;
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
  readonly playEvent: (eventId: string) => void;
  readonly addEvent: (
    methodId: string,
    settings: EventSettings,
  ) => string | undefined;
  readonly setEventSteps: (
    eventId: string,
    steps: readonly (string | number | null)[],
  ) => void;
  readonly updateEvent: (
    eventId: string,
    settings: Partial<EventSettings>,
  ) => void;
  readonly removeEvent: (eventId: string) => void;
  readonly setTransport: (transport: Transport) => void;
  readonly stop: () => void;
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
  readonly eventIds: readonly string[];
  readonly params: Record<string, Param>;
  readonly methods: Record<string, Method>;
  readonly events: Record<string, RackEvent>;
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

  const events = Object.fromEntries(
    Object.entries(template.events ?? {}).map(([key, { method, ...event }]) => {
      const id = `${blockId}:event:${key}`;
      const methodId = `${blockId}:method:${method}`;
      return [
        id,
        { ...event, id, methodId, belongToBlockId: blockId },
      ] as const;
    }),
  );

  return {
    jacks,
    paramIds: normalizedParams.group,
    methodIds: Object.keys(methods),
    eventIds: Object.keys(events),
    params: normalizedParams.params,
    methods,
    events,
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

// An event is only kept when its method can take the time Tone fires it at,
// and, for the kinds that step through values, a note to put each value in.
// Every time is checked here because a bad one would only throw once Tone
// fires it, inside a transport callback, where nothing can catch it.
const acceptEvent = (
  method: Method | undefined,
  event: RackEvent,
): RackEvent | undefined => {
  if (
    method === undefined ||
    !isRackEvent(event) ||
    timeArg(method) === undefined ||
    (event.kind !== "event" && noteArg(method) === undefined)
  ) {
    return undefined;
  }

  // The time, and the note when the event has values, are filled in when it
  // fires; every other required argument has to be fixed up front, as a
  // method call would need it. A loop has no value, so its note is fixed.
  const fixedNote = event.kind === "event" && event.value === undefined;
  const missing = method.args.some(
    (arg) =>
      arg.optional !== true &&
      arg !== timeArg(method) &&
      (fixedNote || arg !== noteArg(method)) &&
      event.args[arg.name] === undefined,
  );
  const knobsFit =
    (event.probability === undefined ||
      (event.probability >= 0 && event.probability <= 1)) &&
    (typeof event.humanize !== "string" || isTime(event.humanize));
  if (missing || !knobsFit) return undefined;

  switch (event.kind) {
    case "sequence":
      return event.steps.length > 0 && isTime(event.subdivision)
        ? event
        : undefined;
    case "event": {
      const loopFits =
        event.loop === false ||
        (event.loopEnd !== undefined &&
          isTime(event.loopEnd) &&
          (event.loop === true ||
            (Number.isInteger(event.loop) && event.loop > 0)));
      return isTime(event.start) && loopFits ? event : undefined;
    }
    case "pattern":
      return event.values.length > 0 && isTime(event.interval)
        ? event
        : undefined;
    case "part":
      return event.steps.length > 0 &&
        event.steps.every((step) => isTime(step.time)) &&
        (event.loopEnd === undefined || isTime(event.loopEnd))
        ? event
        : undefined;
  }
};

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
  patches: {},
  events: {},
  transport: { bpm: 120 },
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
      eventIds: normalized.eventIds,
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
      events: { ...state.events, ...normalized.events },
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
      patches: without(state.patches, (id) => cut.has(id)),
      events: without(state.events, (_, event) =>
        doomed.has(event.belongToBlockId),
      ),
    });
    // Patches and events first, while the nodes they use are still in the
    // graph.
    const { runtime } = get();
    const dropped = Object.values(state.events).filter((event) =>
      doomed.has(event.belongToBlockId),
    );
    perform(
      Effect.gen(function* () {
        for (const patchId of cut) yield* runtime.deletePatch(patchId);
        for (const event of dropped) yield* runtime.deleteEvent(event.id);
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

  // Fires an event's method once, now: its fixed args, plus its first value
  // as the note when it does not fix one. The time arg is left out.
  playEvent: (eventId) => {
    const { events, methods, runtime } = get();
    const event = events[eventId];
    const method = event === undefined ? undefined : methods[event.methodId];
    if (event === undefined || method === undefined) return;

    const note = noteArg(method);
    const first =
      event.kind === "sequence"
        ? event.steps.find((step) => step !== null)
        : event.kind === "pattern"
          ? event.values[0]
          : event.kind === "part"
            ? event.steps.find((step) => step.value !== null)?.value
            : event.value;
    const args =
      note === undefined ||
      event.args[note.name] !== undefined ||
      first === undefined ||
      first === null
        ? event.args
        : { ...event.args, [note.name]: first };
    const missing = method.args.some(
      (arg) => arg.optional !== true && args[arg.name] === undefined,
    );
    if (missing) return;

    perform(runtime.runLeafMethod(method.id, args));
  },

  addEvent: (methodId, settings) => {
    const method = get().methods[methodId];
    if (method === undefined) return undefined;

    const id = crypto.randomUUID();
    const event = acceptEvent(method, {
      ...settings,
      methodId,
      id,
      belongToBlockId: method.belongToBlockId,
    });
    const block = get().blocks[method.belongToBlockId];
    if (event === undefined || block === undefined) return undefined;

    set((state) => ({
      blocks: {
        ...state.blocks,
        [block.id]: { ...block, eventIds: [...block.eventIds, id] },
      },
      events: { ...state.events, [id]: event },
    }));
    perform(get().runtime.updateEvent(id));

    return id;
  },

  // Changes a sequence's steps while it plays, without rebuilding it.
  setEventSteps: (eventId, steps) => {
    const event = get().events[eventId];
    if (event?.kind !== "sequence" || steps.length === 0) return;

    set((state) => ({
      events: { ...state.events, [eventId]: { ...event, steps } },
    }));
    perform(get().runtime.updateEventLive(eventId));
  },

  updateEvent: (eventId, settings) => {
    const { events, methods } = get();
    const held = events[eventId];
    if (held === undefined) return;

    const event = acceptEvent(methods[held.methodId], {
      ...held,
      ...settings,
    } as RackEvent);
    if (event === undefined) return;

    set((state) => ({ events: { ...state.events, [eventId]: event } }));
    perform(get().runtime.updateEvent(eventId));
  },

  removeEvent: (eventId) => {
    const { blocks, events } = get();
    const event = events[eventId];
    if (event === undefined) return;
    const block = blocks[event.belongToBlockId];

    set((state) => ({
      blocks:
        block === undefined
          ? state.blocks
          : {
              ...state.blocks,
              [block.id]: {
                ...block,
                eventIds: block.eventIds.filter((id) => id !== eventId),
              },
            },
      events: Object.fromEntries(
        Object.entries(state.events).filter(([id]) => id !== eventId),
      ),
    }));
    perform(get().runtime.deleteEvent(eventId));
  },

  setTransport: ({ bpm }) => {
    if (!Number.isFinite(bpm) || bpm <= 0) return;

    set({ transport: { bpm } });
    perform(get().runtime.updateTransport);
  },

  // Queued behind any Run still loading Tone or building the runtime, so a
  // Stop clicked straight after Run cannot be overtaken by it.
  stop: () => {
    running = running
      .then(() => Effect.runPromise(get().runtime.stop))
      .catch((error) => console.warn(error));
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
