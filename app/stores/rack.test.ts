import { beforeEach, expect, test } from "vitest";
import { Effect } from "effect";
import { useStore } from ".";
import { catalogue } from "../catalogue";
import { makeBlock, type Rack } from "../rack/model";

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
  store().addRackFromCatalogue("instruments", "AMSynth", "root", "S");
  store().addRackFromCatalogue("output", "Destination", "root", "D");
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

test("adds a rack under the parent it is given", () => {
  store().addBlock("tree", "root");
  const group = children("root")?.[0] ?? "";
  store().addRack(makeBlock("leaf", group, "leaf"), group);

  expect(children(group)).toEqual(["leaf"]);
  expect(store().racks.leaf?.parentId).toBe(group);
});

test("refuses a parent that is missing or not a tree", () => {
  store().addRack(makeBlock("a", "root", "leaf"), "root");
  store().addRack(makeBlock("b", "a", "leaf"), "a");
  store().addRackFromCatalogue("output", "Destination", "nowhere");

  expect(Object.keys(store().racks)).toEqual(["root", "a"]);
  expect(store().errors).toHaveLength(2);
});

test("lists a rack added twice under its parent once", () => {
  const block = makeBlock("a", "root", "leaf");
  store().addRack(block, "root");
  store().addRack(block, "root");

  expect(children("root")).toEqual(["a"]);
});

test("gives a new block an input and an output jack", () => {
  store().addBlock("leaf", "root");
  const id = children("root")?.[0] ?? "";

  expect(store().racks[id]?.jackIds).toEqual([`${id}:in`, `${id}:out`]);
  expect(Object.keys(store().jacks)).toEqual([`${id}:in`, `${id}:out`]);
});

test("gives a new leaf code that is an Effect", () => {
  store().addBlock("leaf", "root");
  const leaf = store().racks[children("root")?.[0] ?? ""];

  expect(leaf?.type === "leaf" && Effect.isEffect(leaf.code)).toBe(true);
});

test("adds a catalogue item with everything it owns", () => {
  store().addRackFromCatalogue("instruments", "AMSynth", "root", "S");
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
  store().addRackFromCatalogue("instruments", "AMSynth", "root", "S");

  expect(store().values["S:param:volume"]).toBe(0);
  expect(store().values["S:param:oscillator.type"]).toBe("sine");
  expect(store().values["S:param:modulationEnvelope.attack"]).toBe(0.5);
});

test("gives each copy of a catalogue item ids of its own", () => {
  store().addRackFromCatalogue("instruments", "AMSynth", "root", "A");
  store().addRackFromCatalogue("instruments", "AMSynth", "root");
  const [, second] = children("root") ?? [];

  expect(children("root")).toHaveLength(2);
  expect(second).not.toBe("A");
  expect(store().jacks[`${second}:out`]).toBeDefined();
  expect(JSON.stringify(store())).not.toContain("catalogue:");
});

test("leaves the catalogue untouched when adding from it", () => {
  const before = JSON.stringify(catalogue);
  store().addRackFromCatalogue("instruments", "AMSynth", "root", "S");

  const added = store().racks.S;
  const source = catalogue.instruments.AMSynth.rack;

  expect(JSON.stringify(catalogue)).toBe(before);
  expect(added?.type === "leaf" && source.type === "leaf").toBe(true);
  if (added?.type === "leaf" && source.type === "leaf") {
    expect(added.code).toBe(source.code);
  }
});

test("records an error for an item the catalogue lacks", () => {
  store().addRackFromCatalogue("instruments", "Theremin", "root");

  expect(children("root")).toEqual([]);
  expect(store().errors).toEqual([
    "instruments Theremin is not in the catalogue",
  ]);
});

test("gives the Destination only an input jack", () => {
  store().addRackFromCatalogue("output", "Destination", "root", "D");

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
  store().addBlock("tree", "root");
  const group = children("root")?.[2] ?? "";
  store().addRackFromCatalogue("output", "Destination", group, "G");

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
  store().addBlock("tree", "root");
  const group = children("root")?.[0] ?? "";
  store().addRackFromCatalogue("instruments", "AMSynth", group, "S");
  store().addRackFromCatalogue("output", "Destination", group, "D");
  store().connectJacks("S:out", "D:in");

  expect(patchesOf(group)).toHaveLength(1);
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
  store().addBlock("tree", "root");
  const group = children("root")?.[0] ?? "";
  store().addRackFromCatalogue("instruments", "AMSynth", group, "S");
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

  expect(store().transport).toEqual({ bpm: 90 });
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
  store().addRackFromCatalogue("output", "Destination", "root", "D");
  const before = store().racks.D?.jackIds;

  store().addJack("D", "in");
  store().removeJack("D:in");

  expect(store().racks.D?.jackIds).toEqual(before);
  expect(store().jacks["D:in"]).toBeDefined();
  expect(store().errors).toHaveLength(2);
});
