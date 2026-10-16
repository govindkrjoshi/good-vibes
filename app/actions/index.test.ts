import { beforeEach, expect, test } from "vitest";
import { Effect } from "effect";
import {
  applyAction,
  checkAfterTurn,
  describeRack,
  planAction,
  type ActionDeps,
} from "./index";
import type { FixupCheck, RackAction } from "../agent";
import { rackStore } from "../rack";
import {
  initialSandboxStatus,
  type BarrierResult,
  type ErrorEntry,
} from "../sandbox";
import { deepFreeze } from "../testing/freeze";
import { rackActions } from "../testing/rack-actions";

const rack = rackActions(rackStore);

const initial = rackStore.getState();
const state = () => rackStore.getState();

beforeEach(() => {
  rackStore.setState(initial, true);
});

const deps: ActionDeps = {
  store: rackStore,
  sandbox: () => undefined,
  status: () => initialSandboxStatus,
};

const apply = (action: RackAction) => applyAction(deps, action);

const add = async (
  id: string,
  category: string,
  entry: string,
): Promise<string> => {
  const result = await apply({ kind: "add_block", id, category, entry });
  if (!result.ok) throw new Error(result.text);
  return id;
};

const paramId = (blockId: string, name: string): string => {
  const param = Object.values(state().params).find(
    (held) => held.belongToBlockId === blockId && held.name === name,
  );
  if (param === undefined) throw new Error(`no ${name}`);
  return param.id;
};

test("describes an empty rack and what can be added", async () => {
  const result = await apply({ kind: "describe" });

  expect(result).toMatchObject({
    ok: true,
    text: "Looked at the rack: 0 blocks, 0 patches.",
  });
  expect(result.data).toEqual({
    catalogue: [
      { category: "source", entry: "AMOscillator", params: [] },
      {
        category: "instruments",
        entry: "AMSynth",
        params: expect.arrayContaining(["volume", "oscillator.type"]),
      },
      {
        category: "instruments",
        entry: "FMSynth",
        params: expect.arrayContaining(["modulationIndex", "envelope.attack"]),
      },
      { category: "output", entry: "Destination", params: [] },
    ],
    transport: { bpm: 120 },
    blocks: [],
    patches: [],
  });
});

test("adds a block under the id it is given, and says what it has", async () => {
  const result = await apply({
    kind: "add_block",
    id: "synth-1",
    category: "instruments",
    entry: "AMSynth",
  });

  expect(result).toMatchObject({ ok: true, text: "Added AMSynth as synth-1." });
  const data = result.data as ReturnType<typeof describeRack>["blocks"][number];
  expect(data).toMatchObject({
    id: "synth-1",
    name: "AMSynth",
    hasInput: true,
    hasOutput: true,
  });
  expect(state().blocks["synth-1"]?.name).toBe("AMSynth");
  expect(data.params).toContainEqual({
    id: "synth-1:param:volume",
    name: "Volume",
    kind: "number",
    value: 0,
    min: -60,
    max: 12,
    step: 1,
    unit: "dB",
  });
  expect(data.params).toContainEqual(
    expect.objectContaining({
      name: "Type",
      kind: "select",
      value: "sine",
      options: expect.arrayContaining(["sine", "square"]),
    }),
  );
  expect(data.events).toHaveLength(1);
});

test("refuses a block id that is taken", async () => {
  await add("synth-1", "instruments", "AMSynth");

  expect(
    await apply({
      kind: "add_block",
      id: "synth-1",
      category: "output",
      entry: "Destination",
    }),
  ).toEqual({ ok: false, text: "There is already a block with id synth-1." });
  expect(state().blocks["synth-1"]?.name).toBe("AMSynth");
});

test("refuses an entry the catalogue does not have, and says what it has", async () => {
  const result = await apply({
    kind: "add_block",
    id: "fx-1",
    category: "fx",
    entry: "Reverb",
  });

  expect(result).toMatchObject({
    ok: false,
    text: "There is no fx/Reverb in the catalogue.",
  });
  expect(result.data).toMatchObject({
    catalogue: expect.arrayContaining([
      expect.objectContaining({ category: "instruments", entry: "AMSynth" }),
    ]),
  });
  expect(Object.keys(state().blocks)).toEqual(["root"]);
});

test("connects one block's output into another's input", async () => {
  const synth = await add("synth", "instruments", "AMSynth");
  const speakers = await add("speakers", "output", "Destination");

  const result = await apply({
    kind: "connect_blocks",
    fromBlockId: synth,
    toBlockId: speakers,
  });

  expect(result).toMatchObject({
    ok: true,
    text: "Connected AMSynth to Destination.",
  });
  const { patchId } = result.data as { patchId: string };
  expect(state().patches[patchId]).toMatchObject({
    from: `${synth}:out`,
    to: `${speakers}:in`,
  });
  expect(describeRack(state()).patches).toEqual([
    { id: patchId, from: synth, to: speakers },
  ]);
});

test("says why blocks cannot be connected", async () => {
  const synth = await add("synth", "instruments", "AMSynth");
  const speakers = await add("speakers", "output", "Destination");

  expect(
    await apply({
      kind: "connect_blocks",
      fromBlockId: speakers,
      toBlockId: synth,
    }),
  ).toEqual({ ok: false, text: "Destination has no output to patch from." });
  expect(
    await apply({
      kind: "connect_blocks",
      fromBlockId: synth,
      toBlockId: synth,
    }),
  ).toEqual({ ok: false, text: "AMSynth cannot be patched into AMSynth." });
  expect(
    await apply({
      kind: "connect_blocks",
      fromBlockId: "nope",
      toBlockId: synth,
    }),
  ).toEqual({ ok: false, text: "There is no block with id nope." });
  expect(state().patches).toEqual({});
});

test("disconnects a patch", async () => {
  const synth = await add("synth", "instruments", "AMSynth");
  const speakers = await add("speakers", "output", "Destination");
  const { patchId } = (
    await apply({
      kind: "connect_blocks",
      fromBlockId: synth,
      toBlockId: speakers,
    })
  ).data as { patchId: string };

  expect(await apply({ kind: "disconnect", patchId })).toEqual({
    ok: true,
    text: "Disconnected AMSynth from Destination.",
  });
  expect(state().patches).toEqual({});
  expect(await apply({ kind: "disconnect", patchId })).toEqual({
    ok: false,
    text: "There is no patch with id " + patchId + ".",
  });
});

test("removes blocks by name, and refuses ids it does not know", async () => {
  const synth = await add("synth", "instruments", "AMSynth");
  const speakers = await add("speakers", "output", "Destination");

  expect(
    await apply({ kind: "remove_blocks", blockIds: [synth, "nope"] }),
  ).toEqual({
    ok: false,
    text: "There is no block with id nope.",
  });
  expect(Object.keys(state().blocks)).toHaveLength(3);

  expect(
    await apply({ kind: "remove_blocks", blockIds: [synth, speakers] }),
  ).toEqual({ ok: true, text: "Removed AMSynth, Destination." });
  expect(Object.keys(state().blocks)).toEqual(["root"]);
});

test("sets a param and reports the value kept", async () => {
  const synth = await add("synth", "instruments", "AMSynth");
  const volume = paramId(synth, "Volume");

  expect(
    await apply({ kind: "set_param", paramId: volume, value: -12 }),
  ).toEqual({
    ok: true,
    text: "Set AMSynth Volume to -12 dB.",
    data: { paramId: volume, value: -12 },
  });
  expect(
    await apply({ kind: "set_param", paramId: volume, value: 100 }),
  ).toEqual({
    ok: true,
    text: "Set AMSynth Volume to 12 dB (clamped from 100).",
    data: { paramId: volume, value: 12 },
  });
  expect(state().values[volume]).toBe(12);
});

test("says what a param takes when a value is refused", async () => {
  const synth = await add("synth", "instruments", "AMSynth");
  const volume = paramId(synth, "Volume");
  const type = paramId(synth, "Type");

  expect(
    await apply({ kind: "set_param", paramId: volume, value: "loud" }),
  ).toEqual({
    ok: false,
    text: "AMSynth Volume takes a number from -60 to 12.",
  });
  expect(
    await apply({ kind: "set_param", paramId: type, value: "banjo" }),
  ).toEqual({
    ok: false,
    text: "AMSynth Type takes one of sine, square, triangle, sawtooth, pulse, pwm, fatsine, fmsine, amsine.",
  });
  expect(await apply({ kind: "set_param", paramId: "nope", value: 1 })).toEqual(
    {
      ok: false,
      text: "There is no param with id nope.",
    },
  );
});

test("sets the tempo", async () => {
  expect(await apply({ kind: "set_transport", bpm: 90 })).toEqual({
    ok: true,
    text: "Set the tempo to 90 bpm.",
  });
  expect(state().transport).toEqual({ bpm: 90 });
  expect(await apply({ kind: "set_transport", bpm: 0 })).toEqual({
    ok: false,
    text: "The tempo has to be a number above 0.",
  });
});

// --- Planning, stamping, retry and checking ---------------------------------

test("plans from the rack alone, deriving any id it makes from the envelope", async () => {
  await add("synth", "instruments", "AMSynth");
  await add("speakers", "output", "Destination");
  const frozen = deepFreeze({ ...state() });

  const plan = planAction(
    frozen,
    { kind: "connect_blocks", fromBlockId: "synth", toBlockId: "speakers" },
    "env-1",
  );

  expect(plan).toMatchObject({
    _tag: "Edit",
    msgs: [
      {
        _tag: "ConnectJacks",
        patchId: "env-1:patch",
        from: "synth:out",
        to: "speakers:in",
      },
    ],
  });
});

test("dispatches what the agent changes as the agent's", async () => {
  await add("synth", "instruments", "AMSynth");

  expect(state().stamps.block.synth?.origin).toBe("agent");
  expect(state().incarnations.block.synth).toBe(
    state().stamps.block.synth?.envelopeId,
  );
});

test("retries a block as it is, and refuses one it does not know", async () => {
  await add("synth", "instruments", "AMSynth");
  const { rev, workSeq } = state();

  expect(await apply({ kind: "retry", entity: "block", id: "synth" })).toEqual({
    ok: true,
    text: "Building AMSynth again. Check errors to see how it went.",
  });
  expect(state().rev).toBe(rev);
  expect(state().workSeq).toBe(workSeq + 1);
  expect(await apply({ kind: "retry", entity: "patch", id: "p" })).toEqual({
    ok: false,
    text: "There is no patch with id p.",
  });
});

const entry = (overrides: Partial<ErrorEntry>): ErrorEntry => ({
  kind: "build",
  id: "synth",
  code: "LeafThrew",
  message: "boom",
  gen: 1,
  cmdId: 1,
  ...overrides,
});

const checkWith = (
  barrier: BarrierResult,
  errors: Readonly<Record<string, ErrorEntry>> = {},
  signal?: AbortSignal,
) =>
  applyAction(
    {
      ...deps,
      sandbox: () => ({ barrier: () => Effect.succeed(barrier) }),
      status: () => ({ ...initialSandboxStatus, errors }),
    },
    { kind: "check_errors" },
    signal,
  );

test("says there is nothing to check before the audio engine starts", async () => {
  expect(await apply({ kind: "check_errors" })).toEqual({
    ok: false,
    text: "Could not check: the audio engine has not started yet.",
  });
});

test("reports a clean rack, and that playing can still fail later", async () => {
  const result = await checkWith({ _tag: "Settled" });

  expect(result.ok).toBe(true);
  expect(result.text).toContain("No errors");
  expect(result.text).toContain("while playing");
});

test("reports failures grouped by the block at their root, and who changed them", async () => {
  await add("synth", "instruments", "AMSynth");
  await add("speakers", "output", "Destination");
  const { patchId } = (
    await apply({
      kind: "connect_blocks",
      fromBlockId: "synth",
      toBlockId: "speakers",
    })
  ).data as { patchId: string };

  const result = await checkWith(
    { _tag: "Settled" },
    {
      "build:synth": entry({ message: "Leaf has no code" }),
      [`connect:${patchId}`]: entry({
        kind: "connect",
        id: patchId,
        code: "EndpointFailed",
        message: "Leaf has no code",
        rootCause: "synth",
      }),
    },
  );

  expect(result.ok).toBe(true);
  expect(result.text).toBe(
    `2 problems. AMSynth (synth): it did not build: Leaf has no code; ${patchId} could not be connected: Leaf has no code.`,
  );
  expect(result.data).toEqual({
    errors: [
      {
        blockId: "synth",
        name: "AMSynth",
        problems: [
          {
            kind: "build",
            id: "synth",
            code: "LeafThrew",
            message: "Leaf has no code",
            changedBy: "agent",
          },
          {
            kind: "connect",
            id: patchId,
            code: "EndpointFailed",
            message: "Leaf has no code",
            changedBy: "agent",
          },
        ],
      },
    ],
  });
});

test.each([
  [{ _tag: "Disconnected" } as const, "not connected"],
  [{ _tag: "Blocked", cause: "DataCloneError" } as const, "DataCloneError"],
  [{ _tag: "TimedOut" } as const, "still busy"],
])("says why it could not check when the frame %o", async (barrier, why) => {
  const result = await checkWith(barrier);

  expect(result.ok).toBe(false);
  expect(result.text).toContain("Could not check");
  expect(result.text).toContain(why);
});

// --- After a turn ---------------------------------------------------------------

const afterTurn = (
  barrier: BarrierResult,
  errors: Readonly<Record<string, ErrorEntry>> = {},
) =>
  checkAfterTurn({
    ...deps,
    sandbox: () => ({ barrier: () => Effect.succeed(barrier) }),
    status: () => ({ ...initialSandboxStatus, errors }),
  });

test("finds nothing to fix in a clean rack", async () => {
  expect(await afterTurn({ _tag: "Settled" })).toEqual({ _tag: "Clean" });
});

test("cannot check a rack the audio engine has not answered for", async () => {
  expect(await afterTurn({ _tag: "TimedOut" })).toMatchObject({
    _tag: "Unchecked",
    text: expect.stringContaining("still busy"),
  });
});

test("asks the agent to fix every error, the user's too", async () => {
  // Added by the user, not the agent.
  const leaf = rack.addBlock("leaf") ?? "";

  const found = await afterTurn(
    { _tag: "Settled" },
    { [`build:${leaf}`]: entry({ id: leaf, message: "Leaf has no code" }) },
  );

  expect(found).toMatchObject({ _tag: "Errors", count: 1 });
  if (found._tag !== "Errors") throw new Error("expected errors");
  expect(found.prompt).toContain("Leaf has no code");
  expect(found.prompt).toContain("whoever made it");
});

test("counts a change to a failing block as a try, even if it fails the same way", async () => {
  await add("synth", "instruments", "AMSynth");
  const failing = { "build:synth": entry({}) };
  const before = await afterTurn({ _tag: "Settled" }, failing);

  await apply({ kind: "set_param", paramId: "synth:param:volume", value: -6 });
  const changed = await afterTurn({ _tag: "Settled" }, failing);
  await apply({ kind: "retry", entity: "block", id: "synth" });
  const after = await afterTurn({ _tag: "Settled" }, failing);

  const print = (found: FixupCheck) =>
    found._tag === "Errors" ? found.fingerprint : found._tag;
  // Changing a param of a block that failed to build rebuilds it: a try.
  expect(print(changed)).not.toBe(print(before));
  // A retry changes nothing in the rack, so failing again is no new try.
  expect(print(after)).toBe(print(changed));

  rack.removeBlocks(["synth"]);
  await add("synth", "instruments", "AMSynth");
  const rebuilt = await afterTurn({ _tag: "Settled" }, failing);
  expect(print(rebuilt)).not.toBe(print(after));
});
