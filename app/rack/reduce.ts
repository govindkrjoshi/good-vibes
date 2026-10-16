import {
  entityChanges,
  entityKinds,
  hasChanges,
  type EntityChanges,
  type EntityKind,
} from "./entities";
import type { Origin, RackEnvelope, RackMsg } from "./messages";
import {
  makeBlock,
  makeDefaultJacks,
  noteArg,
  type Patch,
  type ParamValue,
  type Rack,
  type RackState,
} from "./model";
import {
  acceptEvent,
  acceptValue,
  isTime,
  normalizeTemplate,
  resolvePatch,
} from "./rules";

// The rack's one way to change: a pure function from the rack and a message
// to the next rack and what came of the message. The store calls it from
// `dispatch`; nothing else writes to the rack.

// Who last changed an entity, for telling its history apart.
export type Stamp = {
  readonly rev: number;
  readonly envelopeId: string;
  readonly origin: Origin;
  readonly turnId?: string;
  readonly chainId?: string;
};

type ByKind<T> = Readonly<Record<EntityKind, Readonly<Record<string, T>>>>;

export type RackMeta = {
  // Advances once for each dispatch that changes the rack.
  readonly rev: number;
  // Advances once for each dispatch that gives the sandbox something to do:
  // every new `rev`, and every trigger. Whatever waits on the sandbox waits
  // on this, so a Run or a Play at an unchanged rack is still waited for.
  readonly workSeq: number;
  readonly stamps: ByKind<Stamp>;
  // The envelope that made each entity. An id that is removed and made again
  // is a different entity, even when its data comes out the same.
  readonly incarnations: ByKind<string>;
};

export type RackCore = RackState & RackMeta;

const emptyByKind = <T>(): ByKind<T> =>
  Object.fromEntries(entityKinds.map((kind) => [kind, {}])) as ByKind<T>;

export const initialRackMeta: RackMeta = {
  rev: 0,
  workSeq: 0,
  stamps: emptyByKind(),
  incarnations: emptyByKind(),
};

export type RefusalCode =
  | "NoRoot"
  | "IdTaken"
  | "InvalidConnection"
  | "ValueRejected"
  | "AutomationRejected"
  | "UnknownMethod"
  | "UnknownEvent"
  | "EventRejected"
  | "TransportRejected"
  | "NotPlayable";

export type Refused = {
  readonly _tag: "Refused";
  readonly code: RefusalCode;
  readonly text: string;
};

// What came of one message. `Unchanged` is accepted but changes nothing, like
// removing what is already gone. In a batch that is refused part way, the
// messages before the refusal are `RolledBack` and those after it `Skipped`.
export type Outcome =
  | { readonly _tag: "Committed"; readonly id?: string }
  | { readonly _tag: "Unchanged"; readonly id?: string }
  | { readonly _tag: "RolledBack" }
  | { readonly _tag: "Skipped" }
  | Refused;

const refuse = (code: RefusalCode, text: string): Refused => ({
  _tag: "Refused",
  code,
  text,
});

// --- Applying one message -------------------------------------------------

// What one message does to the rack: the parts of it that change, if any,
// or that it is work for the sandbox that leaves the rack alone.
type Applied =
  | {
      readonly _tag: "Edited";
      readonly patch: Partial<RackState>;
      readonly id?: string;
    }
  | { readonly _tag: "Unchanged"; readonly id?: string }
  | { readonly _tag: "Triggered" }
  | Refused;

const edited = (patch: Partial<RackState>, id?: string): Applied =>
  id === undefined ? { _tag: "Edited", patch } : { _tag: "Edited", patch, id };
const unchanged = (id?: string): Applied =>
  id === undefined ? { _tag: "Unchanged" } : { _tag: "Unchanged", id };

const rootTree = (state: RackState) => {
  const root = state.blocks[state.rootId];
  return root?.type === "tree" ? root : undefined;
};

const without = <T>(
  record: Readonly<Record<string, T>>,
  drop: (id: string, value: T) => boolean,
): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).filter(([id, value]) => !drop(id, value)),
  );

// What an event plays when fired by hand: its fixed args, plus its first
// value as the note when it does not fix one. The time arg is left out.
// Undefined when the event or its method is gone, or an arg is missing.
export const playArgs = (
  state: RackState,
  eventId: string,
):
  | {
      readonly methodId: string;
      readonly args: Readonly<Record<string, ParamValue>>;
    }
  | undefined => {
  const event = state.events[eventId];
  const method =
    event === undefined ? undefined : state.methods[event.methodId];
  if (event === undefined || method === undefined) return undefined;

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
  return missing ? undefined : { methodId: method.id, args };
};

const apply = (state: RackState, msg: RackMsg): Applied => {
  switch (msg._tag) {
    case "AddBlock": {
      const root = rootTree(state);
      if (root === undefined) return refuse("NoRoot", "The rack has no root.");
      if (msg.blockId === "" || msg.blockId in state.blocks)
        return refuse("IdTaken", `There is already a block ${msg.blockId}.`);

      const block = makeBlock(msg.blockId, root.id, msg.blockType);
      const jacks = makeDefaultJacks(block.id);
      return edited(
        {
          blocks: {
            ...state.blocks,
            [root.id]: { ...root, children: [...root.children, block.id] },
            [block.id]: block,
          },
          jacks: {
            ...state.jacks,
            ...Object.fromEntries(jacks.map((jack) => [jack.id, jack])),
          },
        },
        block.id,
      );
    }

    case "AddTemplate": {
      const { template, blockId: id } = msg;
      const root = rootTree(state);
      if (root === undefined) return refuse("NoRoot", "The rack has no root.");
      if (id === "" || id in state.blocks)
        return refuse("IdTaken", `There is already a block ${id}.`);

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

      return edited(
        {
          blocks: {
            ...state.blocks,
            [root.id]: { ...root, children: [...root.children, block.id] },
            [block.id]: block,
          },
          jacks: {
            ...state.jacks,
            ...Object.fromEntries(
              normalized.jacks.map((jack) => [jack.id, jack]),
            ),
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
        },
        block.id,
      );
    }

    case "ConnectJacks": {
      const resolved = resolvePatch(state, msg.from, msg.to);
      if (resolved === undefined)
        return refuse(
          "InvalidConnection",
          "Those jacks cannot be connected: it takes an output and an input on two different blocks.",
        );
      const { root, from, to } = resolved;

      // React Flow reports a connection for every drag that lands, so the
      // same pair of jacks can arrive more than once. Two patches between one
      // pair would draw as two edges stacked on the same line, with no way to
      // tell them apart or to remove only one.
      const held = root.patches.find((id) => {
        const patch = state.patches[id];
        return patch?.from === from.id && patch.to === to.id;
      });
      if (held !== undefined) return unchanged(held);
      if (msg.patchId === "" || msg.patchId in state.patches)
        return refuse("IdTaken", `There is already a patch ${msg.patchId}.`);

      const patch: Patch = {
        id: msg.patchId,
        name: `${from.name} → ${to.name}`,
        from: from.id,
        to: to.id,
      };
      return edited(
        {
          blocks: {
            ...state.blocks,
            [root.id]: { ...root, patches: [...root.patches, patch.id] },
          },
          patches: { ...state.patches, [patch.id]: patch },
        },
        patch.id,
      );
    }

    case "RemoveBlocks": {
      const root = rootTree(state);
      if (root === undefined) return refuse("NoRoot", "The rack has no root.");

      const doomed = new Set(
        msg.blockIds.filter((id) => root.children.includes(id)),
      );
      if (doomed.size === 0) return unchanged();

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
      const doomedParam = (paramId: string) => {
        const owner = state.params[paramId]?.belongToBlockId;
        return owner !== undefined && doomed.has(owner);
      };

      return edited({
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
    }

    case "RemovePatches": {
      const root = rootTree(state);
      if (root === undefined) return refuse("NoRoot", "The rack has no root.");

      const cut = new Set(
        msg.patchIds.filter((id) => root.patches.includes(id)),
      );
      if (cut.size === 0) return unchanged();

      return edited({
        blocks: {
          ...state.blocks,
          [root.id]: {
            ...root,
            patches: root.patches.filter((id) => !cut.has(id)),
          },
        },
        patches: without(state.patches, (id) => cut.has(id)),
      });
    }

    case "SetParamValue": {
      const accepted = acceptValue(state.params[msg.paramId], msg.value);
      if (accepted === undefined)
        return refuse(
          "ValueRejected",
          `${JSON.stringify(msg.value)} does not fit param ${msg.paramId}.`,
        );
      if (state.values[msg.paramId] === accepted) return unchanged();

      return edited({ values: { ...state.values, [msg.paramId]: accepted } });
    }

    case "AddAutomation": {
      const { paramId, automationId, event } = msg;
      const param = state.params[paramId];
      if (
        param?.kind !== "number" ||
        !(param.automation?.methods ?? []).includes(event.method) ||
        !Number.isFinite(event.value) ||
        !isTime(event.time) ||
        (event.rampTime !== undefined && !isTime(event.rampTime))
      ) {
        return refuse(
          "AutomationRejected",
          `Param ${paramId} does not take that automation.`,
        );
      }
      const held = state.automations[paramId] ?? [];
      if (automationId === "" || held.some((one) => one.id === automationId))
        return refuse(
          "IdTaken",
          `There is already automation ${automationId}.`,
        );

      return edited(
        {
          automations: {
            ...state.automations,
            [paramId]: [...held, { ...event, id: automationId }],
          },
        },
        automationId,
      );
    }

    case "RemoveAutomation": {
      const held = state.automations[msg.paramId] ?? [];
      if (!held.some((event) => event.id === msg.automationId))
        return unchanged();

      return edited({
        automations: {
          ...state.automations,
          [msg.paramId]: held.filter((event) => event.id !== msg.automationId),
        },
      });
    }

    case "AddEvent": {
      const { eventId: id, methodId, settings } = msg;
      const method = state.methods[methodId];
      if (method === undefined)
        return refuse("UnknownMethod", `There is no method ${methodId}.`);
      if (id === "" || id in state.events)
        return refuse("IdTaken", `There is already an event ${id}.`);

      const event = acceptEvent(method, {
        ...settings,
        methodId,
        id,
        belongToBlockId: method.belongToBlockId,
      });
      const block = state.blocks[method.belongToBlockId];
      if (event === undefined || block === undefined)
        return refuse(
          "EventRejected",
          `Method ${methodId} cannot be scheduled with those settings.`,
        );

      return edited(
        {
          blocks: {
            ...state.blocks,
            [block.id]: { ...block, eventIds: [...block.eventIds, id] },
          },
          events: { ...state.events, [id]: event },
        },
        id,
      );
    }

    case "SetEventSteps": {
      const event = state.events[msg.eventId];
      if (event === undefined)
        return refuse("UnknownEvent", `There is no event ${msg.eventId}.`);
      if (event.kind !== "sequence" || msg.steps.length === 0)
        return refuse(
          "EventRejected",
          `Event ${msg.eventId} is not a sequence, or the steps are empty.`,
        );

      return edited({
        events: {
          ...state.events,
          [msg.eventId]: { ...event, steps: msg.steps },
        },
      });
    }

    case "UpdateEvent": {
      const held = state.events[msg.eventId];
      if (held === undefined)
        return refuse("UnknownEvent", `There is no event ${msg.eventId}.`);

      const event = acceptEvent(state.methods[held.methodId], {
        ...held,
        ...msg.settings,
      } as typeof held);
      if (event === undefined)
        return refuse(
          "EventRejected",
          `Event ${msg.eventId} cannot take those settings.`,
        );

      return edited({ events: { ...state.events, [msg.eventId]: event } });
    }

    case "RemoveEvent": {
      const event = state.events[msg.eventId];
      if (event === undefined) return unchanged();
      const block = state.blocks[event.belongToBlockId];

      return edited({
        blocks:
          block === undefined
            ? state.blocks
            : {
                ...state.blocks,
                [block.id]: {
                  ...block,
                  eventIds: block.eventIds.filter((id) => id !== msg.eventId),
                },
              },
        events: without(state.events, (id) => id === msg.eventId),
      });
    }

    case "SetTransport": {
      if (!Number.isFinite(msg.bpm) || msg.bpm <= 0)
        return refuse("TransportRejected", "The tempo has to be above zero.");
      if (state.transport.bpm === msg.bpm) return unchanged();

      return edited({ transport: { bpm: msg.bpm } });
    }

    case "Run":
    case "Stop":
      return { _tag: "Triggered" };

    case "PlayEvent":
      return playArgs(state, msg.eventId) === undefined
        ? refuse(
            "NotPlayable",
            `Event ${msg.eventId} cannot be played: it or its method is gone, or an argument is missing.`,
          )
        : { _tag: "Triggered" };
  }
};

// --- Stamps and incarnations ---------------------------------------------

const updateTable = <T>(
  table: Readonly<Record<string, T>>,
  drop: readonly string[],
  put: readonly string[],
  value: T,
): Readonly<Record<string, T>> => {
  if (drop.length === 0 && put.length === 0) return table;
  const dropped = new Set(drop);
  return Object.fromEntries([
    ...Object.entries(table).filter(([id]) => !dropped.has(id)),
    ...put.map((id) => [id, value] as const),
  ]);
};

const record = (
  meta: RackMeta,
  changes: EntityChanges,
  stamp: Stamp,
): Pick<RackMeta, "stamps" | "incarnations"> => ({
  stamps: Object.fromEntries(
    entityKinds.map((kind) => {
      const { added, changed, removed } = changes[kind];
      return [
        kind,
        updateTable(meta.stamps[kind], removed, [...added, ...changed], stamp),
      ];
    }),
  ) as ByKind<Stamp>,
  incarnations: Object.fromEntries(
    entityKinds.map((kind) => {
      const { added, removed } = changes[kind];
      return [
        kind,
        updateTable(meta.incarnations[kind], removed, added, stamp.envelopeId),
      ];
    }),
  ) as ByKind<string>,
});

const stampOf = (envelope: RackEnvelope, rev: number): Stamp => ({
  rev,
  envelopeId: envelope.id,
  origin: envelope.origin,
  ...(envelope.turnId === undefined ? {} : { turnId: envelope.turnId }),
  ...(envelope.chainId === undefined ? {} : { chainId: envelope.chainId }),
});

// --- Reducing -------------------------------------------------------------

export type Reduced<S extends RackCore> = {
  readonly state: S;
  readonly outcomes: readonly Outcome[];
};

// Applies the envelopes in order, all or nothing: if one is refused, the
// state is handed back as it was. A batch that changes the rack is one
// revision, and one unit of work, however many messages it holds. The state
// is the same object when nothing changed. Anything else the state carries,
// like a store's actions, is passed through.
export const reduceAll = <S extends RackCore>(
  state: S,
  envelopes: readonly RackEnvelope[],
): Reduced<S> => {
  const rev = state.rev + 1;
  let draft: S = state;
  let changed = false;
  let worked = false;
  const outcomes: Outcome[] = [];

  for (const [index, envelope] of envelopes.entries()) {
    const applied = apply(draft, envelope.msg);
    switch (applied._tag) {
      case "Refused":
        return {
          state,
          outcomes: [
            ...outcomes.map((): Outcome => ({ _tag: "RolledBack" })),
            applied,
            ...envelopes
              .slice(index + 1)
              .map((): Outcome => ({ _tag: "Skipped" })),
          ],
        };
      case "Unchanged":
        outcomes.push(applied);
        break;
      case "Triggered":
        worked = true;
        outcomes.push({ _tag: "Committed" });
        break;
      case "Edited": {
        const next = { ...draft, ...applied.patch };
        const changes = entityChanges(draft, next);
        if (!hasChanges(changes)) {
          outcomes.push(
            applied.id === undefined
              ? { _tag: "Unchanged" }
              : { _tag: "Unchanged", id: applied.id },
          );
          break;
        }
        draft = { ...next, ...record(draft, changes, stampOf(envelope, rev)) };
        changed = true;
        worked = true;
        outcomes.push(
          applied.id === undefined
            ? { _tag: "Committed" }
            : { _tag: "Committed", id: applied.id },
        );
        break;
      }
    }
  }

  if (!worked) return { state, outcomes };
  return {
    state: {
      ...draft,
      rev: changed ? rev : state.rev,
      workSeq: state.workSeq + 1,
    },
    outcomes,
  };
};

export const reduce = <S extends RackCore>(
  state: S,
  envelope: RackEnvelope,
): { readonly state: S; readonly outcome: Outcome } => {
  const { state: next, outcomes } = reduceAll(state, [envelope]);
  return { state: next, outcome: outcomes[0] ?? { _tag: "Unchanged" } };
};
