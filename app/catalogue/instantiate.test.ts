import { expect, test } from "vitest";
import { instantiate } from "./instantiate";
import { defineItem, frequency, indexJack, input, volume } from "./kit";

const item = defineItem("components", "Thing", {
  description: "A test item.",
  code: "Effect.void",
  params: {
    params: [volume(), frequency({ patchable: true })],
    groups: {
      amp: { name: "Amp", params: [volume({ path: ["amp", "gain"] })] },
    },
  },
  methods: [{ name: "Go", method: "go", args: [] }],
  events: [
    {
      kind: "sequence",
      method: "go",
      steps: [1],
      subdivision: "4n",
      args: {},
      mute: false,
    },
  ],
});

test("gives everything an item owns ids under the rack's", () => {
  const placed = instantiate(item, "R");

  expect(placed.rack).toMatchObject({
    id: "R",
    name: "Thing",
    type: "leaf",
    paramGroupId: "R:paramGroup",
    methodIds: ["R:method:go"],
    eventIds: ["R:event:0"],
    code: "Effect.void",
  });
  expect(placed.paramGroup.groups?.amp?.id).toBe("R:paramGroup:amp");
  expect(placed.paramGroup.params?.map((param) => param.id)).toEqual([
    "R:param:volume",
    "R:param:frequency",
  ]);
  expect(placed.events["R:event:0"]?.methodId).toBe("R:method:go");
});

test("starts every param at its default", () => {
  expect(instantiate(item, "R").values).toEqual({
    "R:param:volume": 0,
    "R:param:frequency": 440,
    "R:param:amp.gain": 0,
  });
});

test("keeps the spec's own fields off what it places", () => {
  const placed = instantiate(item, "R");
  const params = placed.paramGroup.params ?? [];

  expect(params.some((param) => "patchable" in param)).toBe(false);
  expect(Object.values(placed.events).some((event) => "method" in event)).toBe(
    false,
  );
});

test("gives an item without jacks a bare input and output", () => {
  const placed = instantiate(item, "R");

  expect(placed.rack.jackIds).toEqual(["R:in", "R:out", "R:mod:frequency"]);
});

test("gives a patchable param a jack on that param", () => {
  expect(instantiate(item, "R").jacks["R:mod:frequency"]).toEqual({
    id: "R:mod:frequency",
    name: "Frequency",
    belongToBlockId: "R",
    direction: "in",
    port: { member: ["frequency"] },
  });
});

test("keys jacks that share a direction", () => {
  const merge = defineItem("components", "Merge", {
    description: "Two into one.",
    code: "Effect.void",
    jacks: [
      indexJack("in", "left", "L", 0),
      indexJack("in", "right", "R", 1),
      { direction: "out" },
    ],
  });

  expect(instantiate(merge, "M").rack.jackIds).toEqual([
    "M:in:left",
    "M:in:right",
    "M:out",
  ]);
});

test("names a jack after its direction unless told otherwise", () => {
  const sink = defineItem("outputs", "Sink", {
    description: "Takes signal.",
    code: "Effect.void",
    jacks: [input()],
  });

  expect(instantiate(sink, "S").jacks).toEqual({
    "S:in": {
      id: "S:in",
      name: "Input",
      belongToBlockId: "S",
      direction: "in",
    },
  });
});
