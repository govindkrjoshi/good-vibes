import { beforeEach, expect, test } from "vitest";
import { useStore } from "../../stores";
import { createErrorWatch, createRackTools } from ".";

// Every tool runs against the real store, as it does in the app, with the
// sandbox channel going nowhere.

const initial = useStore.getState();
const rack = () => useStore.getState().rack;

const tools = createRackTools(useStore);
const tool = (name: string) => {
  const found = tools.find((held) => held.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
};

// Runs a tool as the agent loop would, returning its text and whether it
// failed.
const call = async (name: string, args: object = {}) => {
  const result = await tool(name).execute("call", args);
  const text = result.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
  return {
    text,
    failed: result.isError === true,
    summary: result.details.summary,
  };
};

const bassIntoSpeakers = async () => {
  await call("add_rack", { item: "tone/MonoSynth", id: "bass" });
  await call("add_rack", { item: "tone/Destination", id: "out" });
  await call("connect", { from: "bass:out", to: "out:in" });
};

beforeEach(() => {
  useStore.setState(initial, true);
});

test("has a tool for everything the user can do, and reads", () => {
  expect(tools.map((held) => held.name).sort()).toEqual(
    [
      "read_rack",
      "read_catalogue",
      "add_rack",
      "create_rack",
      "update_rack",
      "add_group",
      "move_rack",
      "remove_racks",
      "clear_rack",
      "load_demo",
      "add_jack",
      "remove_jack",
      "connect",
      "disconnect",
      "set_params",
      "add_automation",
      "remove_automation",
      "add_event",
      "update_event",
      "set_event_steps",
      "remove_event",
      "set_transport",
    ].sort(),
  );
});

test("reads the rack as a tree with ids, patches and the transport", async () => {
  await bassIntoSpeakers();
  const { text } = await call("read_rack");

  expect(text).toContain("Transport: 120 bpm, stopped.");
  expect(text).toContain("[root] Root (tree)");
  expect(text).toContain("[bass] MonoSynth (tone/MonoSynth)");
  expect(text).toContain("in: bass:in");
  expect(text).toContain("out: bass:out");
  expect(text).toMatch(/\[[0-9a-f-]+\] bass:out -> out:in/);
  expect(text).toContain("No errors reported.");
  expect(text).not.toContain("Effect.gen");
});

test("reads one rack with its params, methods and events by id", async () => {
  await bassIntoSpeakers();
  await call("set_params", {
    values: [{ paramId: "bass:param:volume", value: -6 }],
  });
  const { text } = await call("read_rack", { rackId: "bass" });

  expect(text).toContain("[bass] MonoSynth — tone/MonoSynth, in root");
  expect(text).toContain(
    "bass:param:volume: -6 — Volume, number -60..12 step 1 dB",
  );
  expect(text).toContain("bass:param:oscillator.type:");
  expect(text).toContain(
    "bass:method:triggerAttackRelease: triggerAttackRelease(note: note, duration: time",
  );
  expect(text).toContain("[bass:event:0] sequence every 8n:");
  expect(text).toContain("bass:out -> out:in");
  expect(text).not.toContain("Code:");

  const withCode = await call("read_rack", { rackId: "bass", withCode: true });
  expect(withCode.text).toContain("Code:\nEffect.gen");

  const missing = await call("read_rack", { rackId: "nope" });
  expect(missing.failed).toBe(true);
  expect(missing.text).toContain("There is no rack nope");
});

test("reads the catalogue, filtered, and one item in full", async () => {
  const all = await call("read_catalogue");
  expect(all.text).toContain("Plugins loaded: tone (Tone.js");
  expect(all.text).toContain("instruments (");
  expect(all.text).toContain("tone/MonoSynth — ");

  const some = await call("read_catalogue", {
    query: "delay",
    category: "effects",
  });
  expect(some.text).toContain("tone/FeedbackDelay");
  expect(some.text).not.toContain("tone/MonoSynth");

  const several = await call("read_catalogue", { query: "kick snare limiter" });
  expect(several.text).toContain("tone/MembraneSynth");
  expect(several.text).toContain("tone/NoiseSynth");
  expect(several.text).toContain("tone/Limiter");

  const none = await call("read_catalogue", { query: "theremin" });
  expect(none.text).toContain('Nothing in the catalogue matches "theremin"');

  const item = await call("read_catalogue", { key: "tone/AutoFilter" });
  expect(item.text).toContain("tone/AutoFilter — effects, from plugin tone");
  expect(item.text).toContain("wet: number 0..1");
  expect(item.text).toContain("patchable");
  expect(item.text).toContain("[Filter]");
  expect(item.text).not.toContain("Code:");

  const code = await call("read_catalogue", {
    key: "autofilter",
    withCode: true,
  });
  expect(code.text).toContain("Code:\nEffect.gen");
});

test("adds a catalogue item with values set, under an id of its own", async () => {
  const { text, failed, summary } = await call("add_rack", {
    item: "tone/MonoSynth",
    id: "bass",
    values: { volume: -6, "envelope.attack": 0.01 },
  });

  expect(failed).toBe(false);
  expect(summary).toBe("Added [bass] MonoSynth from tone/MonoSynth in root.");
  expect(text).toContain("bass:param:volume: -6");
  expect(rack().values["bass:param:envelope.attack"]).toBe(0.01);

  const named = await call("add_rack", { item: "feedbackdelay" });
  expect(named.failed).toBe(false);
  expect(rack().racks["feedbackdelay"]).toBeDefined();
  await call("add_rack", { item: "tone/FeedbackDelay" });
  expect(rack().racks["feedbackdelay-2"]).toBeDefined();
});

test("adds nothing when an item, id, parent or value is wrong", async () => {
  const unknown = await call("add_rack", { item: "tone/Theremin" });
  expect(unknown.failed).toBe(true);
  expect(unknown.text).toContain("not in the catalogue");

  const close = await call("add_rack", { item: "synt" });
  expect(close.text).toContain("Did you mean");
  expect(close.text).toContain("tone/AMSynth");

  await call("add_rack", { item: "tone/MonoSynth", id: "bass" });
  const taken = await call("add_rack", { item: "tone/MonoSynth", id: "bass" });
  expect(taken.text).toBe("There is already a rack bass.");

  const colon = await call("add_rack", { item: "tone/MonoSynth", id: "a:b" });
  expect(colon.text).toContain("can't be a rack id");

  const parent = await call("add_rack", {
    item: "tone/Filter",
    parent: "bass",
  });
  expect(parent.text).toContain("bass is a leaf, not a tree");

  const path = await call("add_rack", {
    item: "tone/Filter",
    id: "f",
    values: { cutoff: 100, Q: 99 },
  });
  expect(path.failed).toBe(true);
  expect(path.text).toContain("Filter has no param cutoff");
  expect(path.text).toContain("Q must be at least");
  expect(rack().racks.f).toBeUndefined();
  expect(Object.keys(rack().racks)).toEqual(["root", "bass"]);
  expect(rack().errors).toEqual([]);
});

const wobble = {
  name: "Wobble",
  description: "A slow wobble.",
  category: "effects",
  code: "Effect.gen(function* () { const { tone } = yield* RenderContext; return new tone.AutoFilter(0.5).start(); })",
  params: {
    params: [
      {
        name: "Wet",
        kind: "number",
        path: ["wet"],
        defaultValue: 1,
        min: 0,
        max: 1,
        patchable: true,
      },
    ],
  },
};

test("creates a rack from a spec of the agent's own", async () => {
  const { text, failed } = await call("create_rack", {
    spec: wobble,
    id: "wob",
  });

  expect(failed).toBe(false);
  expect(text).toContain("Created [wob] Wobble in root from your spec.");
  expect(text).toContain("wob:mod:wet (in) Wet, drives param wob:param:wet");
  expect(text).toContain("The sandbox is building it now");
  const leaf = rack().racks.wob;
  expect(leaf?.type === "leaf" && leaf.item).toBeUndefined();
  expect(leaf?.type === "leaf" && leaf.code).toBe(wobble.code);
  expect(rack().values["wob:param:wet"]).toBe(1);
});

test("turns away a spec that does not hold together", async () => {
  const twice = await call("create_rack", {
    spec: {
      ...wobble,
      params: { params: [wobble.params.params[0], wobble.params.params[0]] },
    },
  });
  expect(twice.failed).toBe(true);
  expect(twice.text).toContain("two params have the path wet");

  const event = await call("create_rack", {
    spec: {
      ...wobble,
      events: [
        { kind: "sequence", method: "go", steps: ["C4"], subdivision: "8n" },
      ],
    },
  });
  expect(event.text).toContain("an event calls go, which it has no method for");

  const shape = await call("create_rack", {
    spec: {
      ...wobble,
      params: { params: [{ name: "X", kind: "number", path: ["x"] }] },
    },
  });
  expect(shape.text).toContain("The spec doesn't hold together");

  expect(Object.keys(rack().racks)).toEqual(["root"]);
});

test("updates a rack from a new spec and says what was dropped", async () => {
  await call("create_rack", { spec: wobble, id: "wob" });
  await call("add_rack", { item: "tone/LFO", id: "lfo" });
  await call("connect", { from: "lfo:out", to: "wob:mod:wet" });
  await call("set_params", {
    values: [{ paramId: "wob:param:wet", value: 0.5 }],
  });

  const { text, failed } = await call("update_rack", {
    rackId: "wob",
    spec: {
      ...wobble,
      code: "Effect.void",
      params: { params: [{ ...wobble.params.params[0], patchable: false }] },
    },
  });

  expect(failed).toBe(false);
  expect(text).toContain("Updated [wob] to Wobble. Dropped 1 patch(es)");
  expect(rack().values["wob:param:wet"]).toBe(0.5);
  expect(rack().patches).toEqual({});
  const leaf = rack().racks.wob;
  expect(leaf?.type === "leaf" && leaf.code).toBe("Effect.void");

  const tree = await call("update_rack", { rackId: "root", spec: wobble });
  expect(tree.text).toContain("root is a tree (group), not a leaf");
});

test("adds a group with named jacks and moves racks into it", async () => {
  await bassIntoSpeakers();
  const group = await call("add_group", {
    name: "Bass chain",
    inputs: ["Dry"],
    outputs: ["Wet"],
  });
  expect(group.failed).toBe(false);
  expect(group.text).toContain("Added group [bass-chain] Bass chain in root.");
  expect(group.text).toMatch(/bass-chain:in:[0-9a-f-]+ \(in\) Dry/);
  expect(group.text).toMatch(/bass-chain:out:[0-9a-f-]+ \(out\) Wet/);

  const moved = await call("move_rack", {
    rackId: "bass",
    parent: "bass-chain",
  });
  expect(moved.failed).toBe(false);
  expect(moved.text).toContain(
    "Moved bass into bass-chain. Dropped 1 patch(es)",
  );
  expect(rack().racks.bass?.parentId).toBe("bass-chain");
  expect(rack().patches).toEqual({});

  const root = await call("move_rack", {
    rackId: "root",
    parent: "bass-chain",
  });
  expect(root.text).toBe("The root rack stays as it is.");
});

test("removes racks with what is inside them", async () => {
  await bassIntoSpeakers();
  await call("add_group", { id: "g" });
  await call("move_rack", { rackId: "bass", parent: "g" });
  const { text } = await call("remove_racks", { rackIds: ["g"] });

  expect(text).toBe("Removed g and 1 rack(s) inside them.");
  expect(Object.keys(rack().racks)).toEqual(["root", "out"]);

  const missing = await call("remove_racks", { rackIds: ["out", "nope"] });
  expect(missing.failed).toBe(true);
  expect(rack().racks.out).toBeDefined();
});

test("clears the rack and loads a demo", async () => {
  await bassIntoSpeakers();
  const cleared = await call("clear_rack");
  expect(cleared.text).toBe("Cleared the rack: 2 rack(s) removed.");
  expect(Object.keys(rack().racks)).toEqual(["root"]);

  const demo = await call("load_demo", { demoId: "dub-pulse" });
  expect(demo.failed).toBe(false);
  expect(demo.text).toContain("Loaded the demo Dub Pulse.");
  expect(demo.text).toContain("[bass] Bass · MonoSynth (tone/MonoSynth)");
  expect(rack().transport.bpm).toBe(76);

  const none = await call("load_demo", { demoId: "nope" });
  expect(none.text).toContain("There is no demo nope");
});

test("adds and removes jacks on a tree only", async () => {
  await call("add_group", { id: "g" });
  const added = await call("add_jack", { rackId: "g", direction: "in" });
  expect(added.text).toMatch(/Added jack g:in:[0-9a-f-]+ \(in\) on g\./);
  const [jackId] = rack().racks.g?.jackIds ?? [];
  expect(rack().jacks[jackId ?? ""]?.name).toBe("In 1");

  await call("add_rack", { item: "tone/Filter", id: "f", parent: "g" });
  await call("connect", { from: jackId, to: "f:in" });
  const removed = await call("remove_jack", { jackId });
  expect(removed.text).toContain("and 1 patch(es) to it");
  expect(rack().patches).toEqual({});

  const leaf = await call("add_jack", { rackId: "f", direction: "out" });
  expect(leaf.text).toContain("f is a leaf, not a tree");
  const fixed = await call("remove_jack", { jackId: "f:in" });
  expect(fixed.text).toContain("f is a leaf, not a tree");
});

test("patches jacks and explains a patch that can't be made", async () => {
  await call("add_rack", { item: "tone/MonoSynth", id: "bass" });
  await call("add_rack", { item: "tone/Destination", id: "out" });
  const patched = await call("connect", { from: "bass:out", to: "out:in" });
  expect(patched.text).toMatch(
    /Patched \[[0-9a-f-]+\] bass:out \(Output\) -> out:in \(Input\)\./,
  );

  const again = await call("connect", { from: "bass:out", to: "out:in" });
  expect(again.failed).toBe(false);
  expect(again.text).toContain("was already patched");
  expect(Object.keys(rack().patches)).toHaveLength(1);

  const backwards = await call("connect", { from: "out:in", to: "bass:out" });
  expect(backwards.failed).toBe(true);
  expect(backwards.text).toContain("out:in is an in jack on out (in root)");
  expect(backwards.text).toContain("A patch goes from an output jack");

  const missing = await call("connect", { from: "bass:output", to: "out:in" });
  expect(missing.text).toContain("There is no jack bass:output");

  const [patchId] = Object.keys(rack().patches);
  const removed = await call("disconnect", { patchIds: [patchId] });
  expect(removed.text).toBe("Removed 1 patch(es).");
  expect(rack().patches).toEqual({});
});

test("sets params that fit, and none when one doesn't", async () => {
  await bassIntoSpeakers();
  const bad = await call("set_params", {
    values: [
      { paramId: "bass:param:volume", value: -6 },
      { paramId: "bass:param:oscillator.type", value: "saw" },
      { paramId: "bass:param:nothing", value: 1 },
    ],
  });
  expect(bad.failed).toBe(true);
  expect(bad.text).toContain("There is no param bass:param:nothing");
  expect(rack().values["bass:param:volume"]).toBe(0);

  const wrong = await call("set_params", {
    values: [{ paramId: "bass:param:oscillator.type", value: "saw" }],
  });
  expect(wrong.text).toContain('Type must be one of "sine"');

  await call("add_rack", { item: "tone/LFO", id: "lfo" });
  await call("connect", { from: "lfo:out", to: "bass:mod:detune" });
  const good = await call("set_params", {
    values: [
      { paramId: "bass:param:volume", value: -6 },
      { paramId: "bass:param:detune", value: 50 },
    ],
  });
  expect(good.failed).toBe(false);
  expect(good.text).toContain("Set 2 param(s).");
  expect(good.text).toContain("bass:param:detune = 50 (driven by LFO for now");
  expect(rack().values["bass:param:detune"]).toBe(50);
});

test("schedules and removes a param change", async () => {
  await bassIntoSpeakers();
  const bad = await call("add_automation", {
    paramId: "bass:param:volume",
    method: "rampTo",
    value: -12,
    time: "1m",
  });
  expect(bad.text).toContain("rampTo needs a rampTime");

  const good = await call("add_automation", {
    paramId: "bass:param:volume",
    method: "rampTo",
    value: -12,
    time: "1m",
    rampTime: "2m",
  });
  expect(good.text).toMatch(
    /Scheduled \[[0-9a-f-]+\] rampTo -12 on bass:param:volume at 1m over 2m\./,
  );
  const [held] = rack().automations["bass:param:volume"] ?? [];

  const gone = await call("remove_automation", {
    paramId: "bass:param:volume",
    automationId: held?.id,
  });
  expect(gone.failed).toBe(false);
  expect(rack().automations["bass:param:volume"]).toEqual([]);
});

test("schedules, changes and removes events", async () => {
  await bassIntoSpeakers();
  const added = await call("add_event", {
    methodId: "bass:method:triggerAttackRelease",
    kind: "sequence",
    steps: ["C2", null, "G1"],
    args: { duration: "8n" },
  });
  expect(added.failed).toBe(false);
  expect(added.text).toContain("The transport is stopped");
  const id = added.text.match(/\[([^\]]+)\]/)?.[1] ?? "";
  expect(rack().events[id]).toMatchObject({
    kind: "sequence",
    subdivision: "8n",
    mute: false,
  });

  const missing = await call("add_event", {
    methodId: "bass:method:triggerAttackRelease",
    kind: "sequence",
    steps: ["C2"],
  });
  expect(missing.text).toContain("args needs duration (time)");

  const changed = await call("update_event", {
    eventId: id,
    mute: true,
    subdivision: "16n",
  });
  expect(changed.failed).toBe(false);
  expect(rack().events[id]).toMatchObject({ mute: true, subdivision: "16n" });

  const steps = await call("set_event_steps", {
    eventId: id,
    steps: ["E2", "E2"],
  });
  expect(steps.text).toBe(`Set 2 step(s) on ${id}.`);
  const empty = await call("set_event_steps", { eventId: id, steps: [] });
  expect(empty.failed).toBe(true);

  const loop = await call("add_event", {
    methodId: "bass:method:triggerRelease",
    kind: "event",
    loopEnd: "1m",
  });
  expect(loop.failed).toBe(false);

  const unpitched = await call("add_event", {
    methodId: "bass:method:triggerRelease",
    kind: "sequence",
    steps: [1, null, 1, null],
  });
  expect(unpitched.failed).toBe(false);

  const silent = await call("add_event", {
    methodId: "bass:method:triggerAttackRelease",
    kind: "event",
    args: { duration: "8n" },
  });
  expect(silent.text).toContain("needs a value or args.note");

  const removed = await call("remove_event", { eventId: id });
  expect(removed.text).toBe(`Removed event ${id}.`);
  expect(rack().events[id]).toBeUndefined();
});

test("sets the transport within reason", async () => {
  const bad = await call("set_transport", { bpm: 0 });
  expect(bad.text).toContain("bpm must be a number greater than 0");

  const good = await call("set_transport", { bpm: 90, playing: true });
  expect(good.text).toBe("Transport: 90 bpm, playing.");
  expect(rack().transport).toEqual({ bpm: 90, playing: true });
});

test("fails a tool with what the store reported, and hands over the rest", async () => {
  const watch = createErrorWatch(useStore);
  const [first] = createRackTools(useStore, watch);
  expect(first).toBeDefined();

  rack().reportError("from before");
  expect(watch.take()).toEqual(["from before"]);
  expect(watch.take()).toEqual([]);

  expect(() =>
    watch.check(() => rack().addRackFromCatalogue("tone/Theremin", "root")),
  ).toThrow("- tone/Theremin is not in the catalogue");
  expect(watch.take()).toEqual([]);

  rack().reportError("from the sandbox");
  expect(watch.take()).toEqual(["from the sandbox"]);

  rack().load({ ...initial.rack, errors: [] } as never);
  rack().reportError("after a load");
  expect(watch.take()).toEqual(["after a load"]);
});
