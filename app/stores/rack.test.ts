import { beforeEach, expect, test } from "vitest";
import { useStore } from ".";
import { tonePlugin } from "../catalogue";
import {
  defineItem,
  frequency,
  triggerAttackRelease,
  wet,
} from "../catalogue/kit";
import { makeBlock, newTree, type Rack } from "../rack/model";

const initial = useStore.getState();
const store = () => useStore.getState().rack;

const children = (rackId: string) => {
  const held = store().racks[rackId];
  return held?.type === "tree" ? held.children : undefined;
};

const patchesOf = (rackId: string) => {
  const held = store().racks[rackId];
  return held?.type === "tree" ? held.patches : undefined;
};

// A synth `S` patched into a Destination `D`, both under the root.
const synthIntoSpeakers = () => {
  store().addRackFromCatalogue("tone/AMSynth", "root", "S");
  store().addRackFromCatalogue("tone/Destination", "root", "D");
  store().connectJacks("S:out", "D:in");
};

beforeEach(() => {
  useStore.setState(initial, true);
});

test("starts as an empty root tree", () => {
  expect(Object.keys(store().racks)).toEqual(["root"]);
  expect(children("root")).toEqual([]);
  expect(store().errors).toEqual([]);
});

test("loads a whole rack in place of the current one", () => {
  synthIntoSpeakers();
  store().reportError("stale");
  store().setTransport({ bpm: 90, playing: true });

  store().addRackFromCatalogue("tone/Filter", "root", "F");
  const next = {
    ...useStore.getState().rack,
    transport: { bpm: 76, playing: false },
  };
  store().clear();
  store().load(next);

  expect(children("root")).toEqual(["S", "D", "F"]);
  expect(store().values["F:param:frequency"]).toBe(350);
  expect(Object.keys(store().patches)).toHaveLength(1);
  expect(store().transport).toEqual({ bpm: 76, playing: false });
  expect(store().errors).toEqual([]);
});

test("adds a rack under the parent it is given", () => {
  const group = "G";
  store().addRack(newTree(group, "root"), "root");
  store().addRack(makeBlock("leaf", group, "leaf"), group);

  expect(children(group)).toEqual(["leaf"]);
  expect(store().racks.leaf?.parentId).toBe(group);
});

test("refuses a parent that is missing or not a tree", () => {
  store().addRack(makeBlock("a", "root", "leaf"), "root");
  store().addRack(makeBlock("b", "a", "leaf"), "a");
  store().addRackFromCatalogue("tone/Destination", "nowhere");

  expect(Object.keys(store().racks)).toEqual(["root", "a"]);
  expect(store().errors).toHaveLength(2);
});

test("refuses a rack whose id is taken", () => {
  const block = makeBlock("a", "root", "leaf");
  store().addRack(block, "root");
  store().addRack({ ...block, name: "Again" }, "root");
  store().addRackFromCatalogue("tone/Filter", "root", "a");

  expect(children("root")).toEqual(["a"]);
  expect(store().racks.a?.name).toBe("Leaf");
  expect(store().errors).toEqual([
    "there is already a rack a",
    "there is already a rack a",
  ]);
});

test("remembers which catalogue item a leaf came from", () => {
  store().addRackFromCatalogue("tone/AMSynth", "root", "S");
  const synth = store().racks.S;

  expect(synth?.type === "leaf" && synth.item).toBe("tone/AMSynth");
});

const wobble = defineItem("effects", "Wobble", {
  description: "A test item.",
  code: "Effect.void",
  params: {
    params: [
      wet({ patchable: true }),
      frequency({ name: "Rate", defaultValue: 2, min: 0, max: 20 }),
    ],
  },
  methods: [triggerAttackRelease()],
});

test("places a spec of its own as a leaf with everything it owns", () => {
  store().addItem(wobble, "root", "W");
  const leaf = store().racks.W;

  expect(leaf).toMatchObject({
    type: "leaf",
    name: "Wobble",
    parentId: "root",
  });
  expect(leaf?.type === "leaf" && leaf.item).toBeUndefined();
  expect(Object.keys(store().jacks)).toEqual(["W:in", "W:out", "W:mod:wet"]);
  expect(store().values).toEqual({ "W:param:wet": 1, "W:param:frequency": 2 });
  expect(Object.keys(store().methods)).toEqual([
    "W:method:triggerAttackRelease",
  ]);
});

test("makes a leaf over from a new spec, keeping what still fits", () => {
  store().addRackFromCatalogue("tone/LFO", "root", "lfo");
  store().addRackFromCatalogue("tone/Destination", "root", "D");
  store().addItem(wobble, "root", "W");
  store().connectJacks("W:out", "D:in");
  store().connectJacks("lfo:out", "W:mod:wet");
  store().setParamValue("W:param:wet", 0.5);
  store().setParamValue("W:param:frequency", 7);
  store().addAutomation("W:param:frequency", {
    method: "rampTo",
    value: 1,
    time: "1m",
    rampTime: "4n",
  });
  const added = store().addEvent("W:method:triggerAttackRelease", {
    kind: "sequence",
    steps: ["C4"],
    subdivision: "8n",
    args: { duration: "8n" },
    mute: false,
  });

  const next = defineItem("effects", "Wobble 2", {
    description: "Changed.",
    code: "Effect.succeed(1)",
    params: {
      params: [
        wet(),
        frequency({ name: "Rate", defaultValue: 2, min: 0, max: 20 }),
      ],
    },
    methods: [triggerAttackRelease()],
    events: [
      {
        kind: "sequence",
        method: "triggerAttackRelease",
        steps: ["E4"],
        subdivision: "4n",
        args: { duration: "8n" },
        mute: false,
      },
    ],
  });
  store().replaceItem("W", next);
  const leaf = store().racks.W;

  expect(leaf).toMatchObject({ name: "Wobble 2", parentId: "root" });
  expect(leaf?.type === "leaf" && leaf.code).toBe("Effect.succeed(1)");
  expect(children("root")).toEqual(["lfo", "D", "W"]);
  // Wet is no longer patchable, so its jack and the patch into it go.
  expect(Object.keys(store().jacks)).not.toContain("W:mod:wet");
  expect(Object.values(store().patches).map((patch) => patch.to)).toEqual([
    "D:in",
  ]);
  expect(store().values["W:param:wet"]).toBe(0.5);
  expect(store().values["W:param:frequency"]).toBe(7);
  expect(store().automations["W:param:frequency"]).toHaveLength(1);
  // The event added by hand stays; the spec's own events are the new ones.
  expect(leaf?.eventIds).toEqual([added, "W:event:0"]);
  expect(store().events["W:event:0"]?.kind).toBe("sequence");
  expect(store().errors).toEqual([]);
});

test("drops what a new spec no longer fits", () => {
  store().addItem(wobble, "root", "W");
  store().setParamValue("W:param:frequency", 7);
  const next = defineItem("effects", "Wobble", {
    description: "Changed.",
    code: "Effect.void",
    params: {
      params: [
        { kind: "text", name: "Rate", path: ["frequency"], defaultValue: "x" },
      ],
    },
  });
  store().replaceItem("W", next);

  expect(store().values).toEqual({ "W:param:frequency": "x" });
  expect(store().methods).toEqual({});
  expect(store().jacks["W:mod:wet"]).toBeUndefined();
});

test("only makes a leaf over", () => {
  store().addRack(newTree("G", "root"), "root");
  store().replaceItem("G", wobble);
  store().replaceItem("root", wobble);

  expect(store().errors).toEqual([
    "G is not a leaf rack",
    "root is not a leaf rack",
  ]);
});

test("gives a new block an input and an output jack", () => {
  const id = "leaf";
  store().addRack(makeBlock(id, "root", "leaf"), "root");

  expect(store().racks[id]?.jackIds).toEqual([`${id}:in`, `${id}:out`]);
  expect(Object.keys(store().jacks)).toEqual([`${id}:in`, `${id}:out`]);
});

test("gives a new leaf code that fails when it runs", () => {
  store().addRack(makeBlock("leaf", "root", "leaf"), "root");
  const leaf = store().racks.leaf;

  expect(leaf?.type === "leaf" && leaf.code).toContain("Effect.fail");
});

test("adds a catalogue item with everything it owns", () => {
  store().addRackFromCatalogue("tone/AMSynth", "root", "S");
  const synth = store().racks.S;

  expect(children("root")).toEqual(["S"]);
  expect(synth?.parentId).toBe("root");
  expect(synth?.paramGroupId).toBe("S:paramGroup");
  expect(store().paramGroups["S:paramGroup"]).toBeDefined();
  expect(synth?.jackIds.map((id) => store().jacks[id]?.id)).toEqual([
    "S:in",
    "S:out",
  ]);
  expect(synth?.methodIds.every((id) => store().methods[id])).toBe(true);
  expect(synth?.eventIds.map((id) => store().events[id]?.methodId)).toEqual([
    "S:method:triggerAttackRelease",
  ]);
});

test("starts every catalogue param at its default value", () => {
  store().addRackFromCatalogue("tone/AMSynth", "root", "S");

  expect(store().values["S:param:volume"]).toBe(0);
  expect(store().values["S:param:oscillator.type"]).toBe("sine");
  expect(store().values["S:param:modulationEnvelope.attack"]).toBe(0.5);
});

test("gives each copy of a catalogue item ids of its own", () => {
  store().addRackFromCatalogue("tone/AMSynth", "root", "A");
  store().addRackFromCatalogue("tone/AMSynth", "root");
  const [, second] = children("root") ?? [];

  expect(children("root")).toHaveLength(2);
  expect(second).not.toBe("A");
  expect(store().jacks[`${second}:out`]).toBeDefined();
  expect(JSON.stringify(store())).not.toContain("catalogue:");
});

test("leaves the catalogue untouched when adding from it", () => {
  const before = JSON.stringify(tonePlugin);
  store().addRackFromCatalogue("tone/AMSynth", "root", "S");

  const added = store().racks.S;
  const source = tonePlugin.items.find((item) => item.name === "AMSynth");

  expect(JSON.stringify(tonePlugin)).toBe(before);
  expect(added?.type === "leaf" && added.code).toBe(source?.code);
});

test("records an error for an item the catalogue lacks", () => {
  store().addRackFromCatalogue("tone/Theremin", "root");

  expect(children("root")).toEqual([]);
  expect(store().errors).toEqual(["tone/Theremin is not in the catalogue"]);
});

test("gives the Destination only an input jack", () => {
  store().addRackFromCatalogue("tone/Destination", "root", "D");

  expect(store().racks.D?.jackIds).toEqual(["D:in"]);
});

test("connects an output to an input on another rack in the same tree", () => {
  synthIntoSpeakers();
  const [patch] = Object.values(store().patches);

  expect(patch).toMatchObject({ from: "S:out", to: "D:in" });
  expect(patchesOf("root")).toEqual([patch?.id]);
});

test("keeps one patch when the same jacks are connected again", () => {
  synthIntoSpeakers();
  store().connectJacks("S:out", "D:in");

  expect(Object.keys(store().patches)).toHaveLength(1);
});

test("refuses connections that do not go out of one rack into another", () => {
  synthIntoSpeakers();
  store().addRack(tree("t"), "root");
  store().addRackFromCatalogue("tone/Destination", "t", "G");

  expect(store().canConnectJacks("S:out", "D:in")).toBe(true);
  expect(store().canConnectJacks("D:in", "S:out")).toBe(false);
  expect(store().canConnectJacks("S:in", "D:in")).toBe(false);
  expect(store().canConnectJacks("S:out", "S:in")).toBe(false);
  expect(store().canConnectJacks("S:out", "G:in")).toBe(false);
  expect(store().canConnectJacks("S:out", "missing")).toBe(false);

  store().connectJacks("S:in", "D:in");
  expect(Object.keys(store().patches)).toHaveLength(1);
  expect(store().errors).toEqual(["S:in can't be patched to D:in"]);
});

test("patches racks inside a group in that group", () => {
  store().addRack(tree("t"), "root");
  store().addRackFromCatalogue("tone/AMSynth", "t", "S");
  store().addRackFromCatalogue("tone/Destination", "t", "D");
  store().connectJacks("S:out", "D:in");

  expect(patchesOf("t")).toHaveLength(1);
  expect(patchesOf("root")).toEqual([]);
});

test("removes a rack with everything it owns and the patches to it", () => {
  synthIntoSpeakers();
  store().addAutomation("S:param:volume", {
    method: "rampTo",
    value: -6,
    time: "1m",
  });
  store().removeRacks(["S"]);

  expect(children("root")).toEqual(["D"]);
  expect(patchesOf("root")).toEqual([]);
  expect(store().patches).toEqual({});
  expect(Object.keys(store().jacks)).toEqual(["D:in"]);
  expect(Object.keys(store().paramGroups)).toEqual(["D:paramGroup"]);
  expect(store().values).toEqual({});
  expect(store().automations).toEqual({});
  expect(store().methods).toEqual({});
  expect(store().events).toEqual({});
});

test("removes a group with everything inside it", () => {
  const group = "G";
  store().addRack(newTree(group, "root"), "root");
  store().addRackFromCatalogue("tone/AMSynth", group, "S");
  store().removeRacks([group]);

  expect(Object.keys(store().racks)).toEqual(["root"]);
  expect(store().jacks).toEqual({});
  expect(store().paramGroups).toEqual({});
});

test("never removes the root or racks it does not have", () => {
  synthIntoSpeakers();
  store().removeRacks(["root", "missing"]);

  expect(children("root")).toEqual(["S", "D"]);
});

test("removes a patch and leaves its racks and jacks", () => {
  synthIntoSpeakers();
  const [patch] = Object.keys(store().patches);
  store().removePatches([patch ?? ""]);

  expect(store().patches).toEqual({});
  expect(patchesOf("root")).toEqual([]);
  expect(children("root")).toEqual(["S", "D"]);
  expect(Object.keys(store().jacks)).toHaveLength(3);
});

test("sets a param value", () => {
  synthIntoSpeakers();
  store().setParamValue("S:param:volume", -12);

  expect(store().values["S:param:volume"]).toBe(-12);
});

test("schedules and removes automation on a param", () => {
  synthIntoSpeakers();
  const id = store().addAutomation("S:param:volume", {
    method: "rampTo",
    value: -6,
    time: "1m",
    rampTime: "4n",
  });

  expect(store().automations["S:param:volume"]).toEqual([
    { id, method: "rampTo", value: -6, time: "1m", rampTime: "4n" },
  ]);

  store().removeAutomation("S:param:volume", id ?? "");
  expect(store().automations["S:param:volume"]).toEqual([]);
});

test("adds an event to the rack its method belongs to", () => {
  synthIntoSpeakers();
  const id = store().addEvent("S:method:triggerAttackRelease", {
    kind: "sequence",
    steps: ["C4", null],
    subdivision: "8n",
    args: { duration: "16n" },
    mute: false,
  });

  expect(store().events[id ?? ""]).toMatchObject({
    belongToBlockId: "S",
    methodId: "S:method:triggerAttackRelease",
  });
  expect(store().racks.S?.eventIds).toContain(id);
});

test("adds no event for a method the rack lacks", () => {
  synthIntoSpeakers();
  const id = store().addEvent("S:method:missing", {
    kind: "sequence",
    steps: ["C4"],
    subdivision: "8n",
    args: {},
    mute: false,
  });

  expect(id).toBeUndefined();
});

test("sets a sequence's steps and updates its settings", () => {
  synthIntoSpeakers();
  const [riff] = store().racks.S?.eventIds ?? [];
  store().setEventSteps(riff ?? "", ["A3", "B3"]);
  store().updateEvent(riff ?? "", { mute: true });

  expect(store().events[riff ?? ""]).toMatchObject({
    steps: ["A3", "B3"],
    mute: true,
  });
});

test("removes an event from the store and its rack", () => {
  synthIntoSpeakers();
  const [riff] = store().racks.S?.eventIds ?? [];
  store().removeEvent(riff ?? "");

  expect(store().events).toEqual({});
  expect(store().racks.S?.eventIds).toEqual([]);
});

test("sets the tempo", () => {
  store().setTransport({ bpm: 90 });

  expect(store().transport).toEqual({ bpm: 90, playing: false });
});

test("resets to an empty root tree", () => {
  synthIntoSpeakers();
  store().reset();

  expect(Object.keys(store().racks)).toEqual(["root"]);
  expect(children("root")).toEqual([]);
  expect(store().patches).toEqual({});
});

const tree = (id: string): Rack => ({
  ...makeBlock(id, "root", "tree"),
  jackIds: [],
});

test("moves a rack into a tree and back out", () => {
  store().addRack(tree("t"), "root");
  store().addRack(makeBlock("a", "root", "leaf"), "root");

  store().moveRack("a", "t");
  expect(children("root")).toEqual(["t"]);
  expect(children("t")).toEqual(["a"]);
  expect(store().racks.a?.parentId).toBe("t");

  store().moveRack("a", "root");
  expect(children("root")).toEqual(["t", "a"]);
  expect(children("t")).toEqual([]);
  expect(store().racks.a?.parentId).toBe("root");
});

test("moving a rack to the parent it has changes nothing", () => {
  store().addRack(makeBlock("a", "root", "leaf"), "root");

  store().moveRack("a", "root");

  expect(children("root")).toEqual(["a"]);
  expect(store().errors).toEqual([]);
});

test.each([
  ["the root", "root", "t"],
  ["a tree into itself", "t", "t"],
  ["a tree into one inside it", "t", "inner"],
  ["a rack into a leaf", "t", "a"],
  ["a rack that doesn't exist", "ghost", "t"],
])("won't move %s", (_name, rackId, parentId) => {
  store().addRack(tree("t"), "root");
  store().addRack(tree("inner"), "t");
  store().addRack(makeBlock("a", "root", "leaf"), "root");
  const before = store().racks;

  store().moveRack(rackId, parentId);

  expect(store().racks).toEqual(before);
  expect(store().errors).toEqual([`${rackId} can't be moved to ${parentId}`]);
});

test("adds numbered jacks to a tree", () => {
  store().addRack(tree("t"), "root");

  store().addJack("t", "in");
  store().addJack("t", "in");
  store().addJack("t", "out");

  const jacks = store().racks.t?.jackIds.map((id) => store().jacks[id]);
  expect(jacks?.map((jack) => [jack?.name, jack?.direction])).toEqual([
    ["In 1", "in"],
    ["In 2", "in"],
    ["Out 1", "out"],
  ]);
  expect(jacks?.every((jack) => jack?.belongToBlockId === "t")).toBe(true);
});

test("reuses the number of a removed jack", () => {
  store().addRack(tree("t"), "root");
  store().addJack("t", "in");
  store().addJack("t", "in");
  const [first = ""] = store().racks.t?.jackIds ?? [];

  store().removeJack(first);
  store().addJack("t", "in");

  expect(store().racks.t?.jackIds.map((id) => store().jacks[id]?.name)).toEqual(
    ["In 2", "In 1"],
  );
});

test("removes a jack with the patches wired to it", () => {
  store().addRack(tree("t"), "root");
  store().addJack("t", "out");
  store().addJack("t", "out");
  const [jackId = "", other = ""] = store().racks.t?.jackIds ?? [];
  const wired = { id: "p", name: "p", from: jackId, to: "x:in" };
  const spared = { id: "q", name: "q", from: other, to: "x:in" };
  useStore.setState((state) => {
    state.rack.patches = { p: wired, q: spared };
    const root = state.rack.racks.root;
    if (root?.type === "tree") root.patches = ["p", "q"];
  });

  store().removeJack(jackId);

  expect(store().jacks[jackId]).toBeUndefined();
  expect(store().racks.t?.jackIds).toEqual([other]);
  expect(Object.keys(store().patches)).toEqual(["q"]);
  expect(patchesOf("root")).toEqual(["q"]);
});

test("won't change the jacks of a leaf", () => {
  store().addRackFromCatalogue("tone/Destination", "root", "D");
  const before = store().racks.D?.jackIds;

  store().addJack("D", "in");
  store().removeJack("D:in");

  expect(store().racks.D?.jackIds).toEqual(before);
  expect(store().jacks["D:in"]).toBeDefined();
  expect(store().errors).toHaveLength(2);
});

// A group `t` with one input and one output, holding a synth `S`.
const groupAroundSynth = () => {
  store().addRack(tree("t"), "root");
  store().addJack("t", "in");
  store().addJack("t", "out");
  store().addRackFromCatalogue("tone/AMSynth", "t", "S");
  const [input = "", output = ""] = store().racks.t?.jackIds ?? [];
  return { input, output };
};

test("patches a group's input to a child inside the group", () => {
  const { input } = groupAroundSynth();

  expect(store().canConnectJacks(input, "S:in")).toBe(true);
  store().connectJacks(input, "S:in");

  expect(patchesOf("t")).toHaveLength(1);
  expect(patchesOf("root")).toEqual([]);
});

test("patches a child to its group's output inside the group", () => {
  const { output } = groupAroundSynth();

  expect(store().canConnectJacks("S:out", output)).toBe(true);
  store().connectJacks("S:out", output);

  expect(patchesOf("t")).toHaveLength(1);
});

test("patches a group to a sibling in the tree that holds them", () => {
  const { output } = groupAroundSynth();
  store().addRackFromCatalogue("tone/Destination", "root", "D");

  store().connectJacks(output, "D:in");

  expect(patchesOf("root")).toHaveLength(1);
  expect(patchesOf("t")).toEqual([]);
});

test("patches through a group nested in a group", () => {
  const { input } = groupAroundSynth();
  store().addRack(tree("inner"), "t");
  store().addJack("inner", "in");
  const [innerInput = ""] = store().racks.inner?.jackIds ?? [];
  store().addRackFromCatalogue("tone/Destination", "inner", "D");

  store().connectJacks(input, innerInput);
  store().connectJacks(innerInput, "D:in");

  expect(patchesOf("t")).toHaveLength(1);
  expect(patchesOf("inner")).toHaveLength(1);
});

test("refuses patches that skip a level or stay on one rack", () => {
  const { input, output } = groupAroundSynth();
  store().addRackFromCatalogue("tone/Destination", "root", "D");

  // Into a rack in a group from outside it, and out of one the same way.
  expect(store().canConnectJacks("S:out", "D:in")).toBe(false);
  // A child doesn't feed its group's input, or its output feed the child.
  expect(store().canConnectJacks("S:out", input)).toBe(false);
  expect(store().canConnectJacks(output, "S:in")).toBe(false);
  // A group's input doesn't go straight to its own output.
  expect(store().canConnectJacks(input, output)).toBe(false);
});

test("lets a jack take many patches in both directions", () => {
  store().addRackFromCatalogue("tone/AMSynth", "root", "A");
  store().addRackFromCatalogue("tone/AMSynth", "root", "B");
  store().addRackFromCatalogue("tone/Destination", "root", "C");
  store().addRackFromCatalogue("tone/Destination", "root", "D");

  store().connectJacks("A:out", "C:in");
  store().connectJacks("A:out", "D:in");
  store().connectJacks("B:out", "C:in");

  expect(patchesOf("root")).toHaveLength(3);
  expect(store().errors).toEqual([]);
});

test("moving a rack drops the patches it can no longer make", () => {
  const { input, output } = groupAroundSynth();
  store().addRackFromCatalogue("tone/Destination", "root", "D");
  store().addRackFromCatalogue("tone/AMSynth", "root", "R");
  store().connectJacks(input, "S:in");
  store().connectJacks("S:out", output);
  store().connectJacks("R:out", "D:in");

  store().moveRack("S", "root");

  expect(Object.values(store().patches).map((patch) => patch.from)).toEqual([
    "R:out",
  ]);
  expect(patchesOf("t")).toEqual([]);
  expect(patchesOf("root")).toHaveLength(1);
});

test("moving a group keeps the patches inside it", () => {
  const { input } = groupAroundSynth();
  store().addRack(tree("other"), "root");
  store().connectJacks(input, "S:in");

  store().moveRack("t", "other");

  expect(patchesOf("t")).toHaveLength(1);
});
