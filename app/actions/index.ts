import { Effect } from "effect";
import type { StoreApi } from "zustand";
import type { ActionResult, RackAction } from "../agent";
import { CATALOGUE } from "../catalogue";
import type {
  EntityKind,
  Jack,
  Outcome,
  Param,
  ParamTemplateGroup,
  Rack,
  RackCore,
  RackMsg,
  RackState,
  RackStore,
  Refused,
  TreeBlock,
} from "../rack";
import type {
  BarrierResult,
  ErrorEntry,
  SandboxClient,
  SandboxStatus,
} from "../sandbox";

// Makes the changes the agent asks for. The agent only ever sends a
// RackAction out; this works out, from the rack alone, the messages it comes
// to (planAction), dispatches them as the agent's, and tells the agent and
// the chat what came of it (applyAction). Every result's text is a sentence;
// `data` carries the ids the agent needs next.

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

// --- Planning: pure --------------------------------------------------------

// What an action comes to. An answer needs nothing dispatched: a look at
// the rack, or a refusal worked out up front. An edit is messages, applied
// all or nothing, and how to word what came of them. A check waits on the
// sandbox.
export type ActionPlan =
  | { readonly _tag: "Answer"; readonly result: ActionResult }
  | {
      readonly _tag: "Edit";
      readonly msgs: readonly RackMsg[];
      readonly result: (
        after: RackState,
        outcomes: readonly Outcome[],
      ) => ActionResult;
      // Words a refusal from the rack itself; by default, its own text.
      readonly refused?: (refusal: Refused) => ActionResult;
    }
  | { readonly _tag: "Check" };

const answer = (result: ActionResult): ActionPlan => ({
  _tag: "Answer",
  result,
});

const planDescribe = (state: RackState): ActionPlan => {
  const summary = describeRack(state);
  const blocks = summary.blocks.length;
  const patches = summary.patches.length;
  return answer(
    ok(
      `Looked at the rack: ${blocks} ${blocks === 1 ? "block" : "blocks"}, ${patches} ${patches === 1 ? "patch" : "patches"}.`,
      summary,
    ),
  );
};

const planAddBlock = (
  state: RackState,
  { id, category, entry }: Extract<RackAction, { kind: "add_block" }>,
): ActionPlan => {
  const template = CATALOGUE[category]?.[entry]?.rack;
  if (template === undefined) {
    return answer(
      refuse(`There is no ${category}/${entry} in the catalogue.`, {
        catalogue: catalogueEntries(),
      }),
    );
  }
  if (id in state.blocks)
    return answer(refuse(`There is already a block with id ${id}.`));
  return {
    _tag: "Edit",
    msgs: [{ _tag: "AddTemplate", blockId: id, template }],
    result: (after) => {
      const block = after.blocks[id];
      return block === undefined
        ? refuse(`${template.name} could not be added.`)
        : ok(`Added ${block.name} as ${block.id}.`, blockSummary(after, block));
    },
  };
};

const planRemoveBlocks = (
  state: RackState,
  { blockIds }: Extract<RackAction, { kind: "remove_blocks" }>,
): ActionPlan => {
  const known = new Set(childBlocks(state).map((block) => block.id));
  const unknown = blockIds.filter((id) => !known.has(id));
  if (unknown.length > 0)
    return answer(refuse(`There is no block with id ${unknown.join(", ")}.`));

  const names = blockIds.map((id) => state.blocks[id]?.name ?? id);
  return {
    _tag: "Edit",
    msgs: [{ _tag: "RemoveBlocks", blockIds }],
    result: () => ok(`Removed ${names.join(", ")}.`),
  };
};

const planConnectBlocks = (
  state: RackState,
  { fromBlockId, toBlockId }: Extract<RackAction, { kind: "connect_blocks" }>,
  envelopeId: string,
): ActionPlan => {
  const from = state.blocks[fromBlockId];
  const to = state.blocks[toBlockId];
  if (from === undefined)
    return answer(refuse(`There is no block with id ${fromBlockId}.`));
  if (to === undefined)
    return answer(refuse(`There is no block with id ${toBlockId}.`));

  const out = jackOf(state, from, "out");
  const into = jackOf(state, to, "in");
  if (out === undefined)
    return answer(refuse(`${from.name} has no output to patch from.`));
  if (into === undefined)
    return answer(refuse(`${to.name} has no input to patch into.`));

  return {
    _tag: "Edit",
    // The patch's id comes from the envelope, so planning stays pure.
    msgs: [
      {
        _tag: "ConnectJacks",
        patchId: `${envelopeId}:patch`,
        from: out.id,
        to: into.id,
      },
    ],
    // The patch already between the two comes back as it is.
    result: (_, [outcome]) =>
      ok(`Connected ${from.name} to ${to.name}.`, {
        patchId:
          outcome !== undefined && "id" in outcome
            ? outcome.id
            : `${envelopeId}:patch`,
      }),
    refused: () => refuse(`${from.name} cannot be patched into ${to.name}.`),
  };
};

const planDisconnect = (
  state: RackState,
  { patchId }: Extract<RackAction, { kind: "disconnect" }>,
): ActionPlan => {
  const patch = state.patches[patchId];
  if (patch === undefined || !root(state)?.patches.includes(patchId))
    return answer(refuse(`There is no patch with id ${patchId}.`));

  const from = owner(state, patch.from) ?? "a block";
  const to = owner(state, patch.to) ?? "a block";
  return {
    _tag: "Edit",
    msgs: [{ _tag: "RemovePatches", patchIds: [patchId] }],
    result: () => ok(`Disconnected ${from} from ${to}.`),
  };
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

const planSetParam = (
  state: RackState,
  { paramId, value }: Extract<RackAction, { kind: "set_param" }>,
): ActionPlan => {
  const param = state.params[paramId];
  if (param === undefined)
    return answer(refuse(`There is no param with id ${paramId}.`));

  const block = state.blocks[param.belongToBlockId];
  const name = block === undefined ? param.name : `${block.name} ${param.name}`;
  return {
    _tag: "Edit",
    msgs: [{ _tag: "SetParamValue", paramId, value }],
    result: (after) => {
      const stored = after.values[paramId];
      const unit =
        param.kind === "number" && param.unit !== undefined
          ? ` ${param.unit}`
          : "";
      const clamped =
        stored === value ? "" : ` (clamped from ${String(value)})`;
      return ok(`Set ${name} to ${String(stored)}${unit}${clamped}.`, {
        paramId,
        value: stored,
      });
    },
    refused: () => refuse(`${name} takes ${takes(param)}.`),
  };
};

const planSetTransport = ({
  bpm,
}: Extract<RackAction, { kind: "set_transport" }>): ActionPlan => ({
  _tag: "Edit",
  msgs: [{ _tag: "SetTransport", bpm }],
  result: () => ok(`Set the tempo to ${bpm} bpm.`),
  refused: () => refuse("The tempo has to be a number above 0."),
});

const planRetry = (
  state: RackState,
  { entity, id }: Extract<RackAction, { kind: "retry" }>,
): ActionPlan => {
  const name =
    entity === "block"
      ? state.blocks[id]?.name
      : entity === "patch"
        ? state.patches[id] === undefined
          ? undefined
          : `the patch ${id}`
        : state.events[id] === undefined
          ? undefined
          : `the event ${id}`;
  if (name === undefined)
    return answer(refuse(`There is no ${entity} with id ${id}.`));
  return {
    _tag: "Edit",
    msgs: [{ _tag: "Retry", entity, entityId: id }],
    result: () =>
      ok(`Building ${name} again. Check errors to see how it went.`),
  };
};

export const planAction = (
  state: RackState,
  action: RackAction,
  envelopeId: string,
): ActionPlan => {
  switch (action.kind) {
    case "describe":
      return planDescribe(state);
    case "add_block":
      return planAddBlock(state, action);
    case "remove_blocks":
      return planRemoveBlocks(state, action);
    case "connect_blocks":
      return planConnectBlocks(state, action, envelopeId);
    case "disconnect":
      return planDisconnect(state, action);
    case "set_param":
      return planSetParam(state, action);
    case "set_transport":
      return planSetTransport(action);
    case "retry":
      return planRetry(state, action);
    case "check_errors":
      return { _tag: "Check" };
  }
};

// --- What failed, as the agent sees it: pure --------------------------------

const entityOf: Record<ErrorEntry["kind"], EntityKind> = {
  build: "block",
  connect: "patch",
  param: "param",
  schedule: "event",
  play: "event",
  playback: "event",
};

// What each kind of failure means, to start its line in the report.
const failed: Record<ErrorEntry["kind"], string> = {
  build: "did not build",
  connect: "could not be connected",
  param: "could not be set",
  schedule: "could not be scheduled",
  play: "could not be played",
  playback: "failed while playing",
};

// The block a failure is about: its own, or the one whose failure caused it.
const blockOf = (state: RackState, entry: ErrorEntry): string | undefined => {
  switch (entry.kind) {
    case "build":
      return entry.id;
    case "connect": {
      const patch = state.patches[entry.id];
      return (
        entry.rootCause ??
        (patch === undefined
          ? undefined
          : state.jacks[patch.from]?.belongToBlockId)
      );
    }
    case "param":
      return state.params[entry.id]?.belongToBlockId;
    case "schedule":
    case "play":
    case "playback":
      return state.events[entry.id]?.belongToBlockId;
  }
};

// Every failure, grouped by the block at its root, with who last changed
// what failed.
export const errorReport = (
  state: RackCore,
  errors: Readonly<Record<string, ErrorEntry>>,
) => {
  const groups = new Map<
    string,
    {
      blockId: string;
      name: string;
      problems: {
        kind: ErrorEntry["kind"];
        id: string;
        code: string;
        message: string;
        changedBy?: string;
      }[];
    }
  >();
  for (const entry of Object.values(errors)) {
    const blockId = blockOf(state, entry) ?? entry.id;
    const group = groups.get(blockId) ?? {
      blockId,
      name: state.blocks[blockId]?.name ?? blockId,
      problems: [],
    };
    const origin = state.stamps[entityOf[entry.kind]][entry.id]?.origin;
    group.problems.push({
      kind: entry.kind,
      id: entry.id,
      code: entry.code,
      message: entry.message,
      ...(origin === undefined ? {} : { changedBy: origin }),
    });
    groups.set(blockId, group);
  }
  return [...groups.values()];
};

const checked = (
  state: RackCore,
  barrier: BarrierResult,
  status: SandboxStatus,
): ActionResult => {
  switch (barrier._tag) {
    case "Disconnected":
      return refuse(
        "Could not check: the audio engine is not connected. Edits are kept and sent once it is.",
      );
    case "Blocked":
      return refuse(
        `Could not check: the rack could not be sent to the audio engine (${barrier.cause}).`,
      );
    case "TimedOut":
      return refuse(
        "Could not check: the audio engine is still busy. Try again in a moment.",
      );
    case "Settled": {
      const report = errorReport(state, status.errors);
      if (report.length === 0)
        return ok(
          "No errors: everything built, connected and scheduled. An event can still fail later, while playing.",
          { errors: [] },
        );
      const lines = report.map(
        ({ blockId, name, problems }) =>
          `${name} (${blockId}): ${problems
            .map(
              (problem) =>
                `${problem.kind === "build" ? "it" : problem.id} ${failed[problem.kind]}: ${problem.message}`,
            )
            .join("; ")}`,
      );
      const count = report.reduce(
        (sum, { problems }) => sum + problems.length,
        0,
      );
      return ok(
        `${count} ${count === 1 ? "problem" : "problems"}. ${lines.join(". ")}.`,
        { errors: report },
      );
    }
  }
};

// --- Applying ---------------------------------------------------------------

export type ActionDeps = {
  readonly store: StoreApi<RackStore>;
  // The app's end of the sandbox frame, once it has one.
  readonly sandbox: () => Pick<SandboxClient, "barrier"> | undefined;
  readonly status: () => SandboxStatus;
  // How long a check waits for the frame before saying it is still busy.
  readonly checkTimeoutMs?: number;
};

const firstRefusal = (outcomes: readonly Outcome[]) =>
  outcomes.find((outcome): outcome is Refused => outcome._tag === "Refused");

// Carries an action out as the agent's: an edit is dispatched all or
// nothing, so an action is never half done.
export const applyAction = async (
  { store, sandbox, status, checkTimeoutMs = 2000 }: ActionDeps,
  action: RackAction,
  signal?: AbortSignal,
): Promise<ActionResult> => {
  const envelopeId = crypto.randomUUID();
  const plan = planAction(store.getState(), action, envelopeId);
  switch (plan._tag) {
    case "Answer":
      return plan.result;

    case "Edit": {
      const outcomes = store.getState().dispatchAll(
        plan.msgs.map((msg, index) => ({
          id: plan.msgs.length === 1 ? envelopeId : `${envelopeId}#${index}`,
          origin: "agent" as const,
          msg,
        })),
      );
      const refusal = firstRefusal(outcomes);
      if (refusal !== undefined)
        return plan.refused?.(refusal) ?? refuse(refusal.text);
      return plan.result(store.getState(), outcomes);
    }

    case "Check": {
      const client = sandbox();
      if (client === undefined)
        return refuse("Could not check: the audio engine has not started yet.");
      const barrier = await Effect.runPromise(client.barrier(checkTimeoutMs), {
        signal,
      });
      return checked(store.getState(), barrier, status());
    }
  }
};
