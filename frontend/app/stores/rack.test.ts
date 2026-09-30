import { Effect } from "effect";
import { beforeEach, expect, test } from "vitest";
import { useRackStore } from "./rack";
import { hasOutputJack } from "../types/rack";

const initial = useRackStore.getState();

const state = () => useRackStore.getState();
const root = () => state().blocks[state().rootId];

const children = () => {
  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  return block.children;
};

beforeEach(() => {
  useRackStore.setState(initial, true);
});

test("starts as an empty root tree", () => {
  expect(state().rootId).toBe("root");
  expect(Object.keys(state().blocks)).toEqual(["root"]);
  expect(root().type).toBe("tree");
  expect(root().isRoot).toBe(true);
  expect(children()).toEqual([]);
  expect(state().jacks).toEqual({});
  expect(state().patches).toEqual({});
});

test("files each new block under the root and keeps insertion order", () => {
  state().addBlock("leaf");
  state().addBlock("tree");

  const [first, second] = children();
  expect(children()).toHaveLength(2);
  expect(first).not.toBe(second);
  expect(state().blocks[first].type).toBe("leaf");
  expect(state().blocks[second].type).toBe("tree");
});

test("points every added block back at its parent", () => {
  state().addBlock("tree");

  const block = state().blocks[children()[0]];
  expect(block.parentId).toBe("root");
  expect(block.isRoot).toBe(false);
});

test("gives a leaf block an Effect to run", () => {
  state().addBlock("leaf");

  const block = state().blocks[children()[0]];
  if (block.type !== "leaf") throw new Error("expected a leaf block");
  expect(Effect.isEffect(block.code)).toBe(true);
});

test("gives a group block its own empty children and patches", () => {
  state().addBlock("tree");

  const block = state().blocks[children()[0]];
  if (block.type !== "tree") throw new Error("expected a tree block");
  expect(block.children).toEqual([]);
  expect(block.patches).toEqual([]);
});

test("gives each new block one input and one output jack", () => {
  state().addBlock("leaf");

  const block = state().blocks[children()[0]];
  const jacks = block.jackIds.map((id) => state().jacks[id]);

  expect(jacks.map((jack) => jack.direction)).toEqual(["in", "out"]);
  expect(jacks.every((jack) => jack.belongToBlockId === block.id)).toBe(true);
});

test("gives every non-root block an output jack to wire out of", () => {
  const leafId = state().addBlock("leaf");
  const treeId = state().addBlock("tree");
  if (leafId === undefined || treeId === undefined) {
    throw new Error("expected blocks to be added");
  }

  const jacks = state().jacks;
  expect(hasOutputJack(state().blocks[leafId], jacks)).toBe(true);
  expect(hasOutputJack(state().blocks[treeId], jacks)).toBe(true);
  expect(hasOutputJack({ ...state().blocks[leafId], jackIds: [] }, jacks)).toBe(
    false,
  );
});

test("reads a block's output jack off its direction, not its id", () => {
  const blockId = state().addBlock("leaf");
  if (blockId === undefined) throw new Error("expected block to be added");

  const renamed = {
    id: "renamed",
    name: "Out",
    belongToBlockId: blockId,
    direction: "out",
  } as const;

  expect(
    hasOutputJack(
      { ...state().blocks[blockId], jackIds: ["renamed"] },
      {
        ...state().jacks,
        renamed,
      },
    ),
  ).toBe(true);
});

test("exempts the root, which has nothing above it to wire into", () => {
  expect(hasOutputJack(root(), state().jacks)).toBe(true);
});

test("connects output jacks to input jacks on other blocks", () => {
  const fromBlockId = state().addBlock("leaf");
  const toBlockId = state().addBlock("tree");
  if (fromBlockId === undefined || toBlockId === undefined) {
    throw new Error("expected blocks to be added");
  }

  const patchId = state().connectJacks(`${fromBlockId}:out`, `${toBlockId}:in`);

  expect(patchId).toBeTypeOf("string");
  const rootBlock = root();
  expect(rootBlock.type).toBe("tree");
  expect(children()).toEqual([fromBlockId, toBlockId]);
  if (rootBlock.type !== "tree" || patchId === undefined) return;
  expect(rootBlock.patches).toEqual([patchId]);
  expect(state().patches[patchId]).toMatchObject({
    from: `${fromBlockId}:out`,
    to: `${toBlockId}:in`,
  });
});

test("hands back the patch already there rather than doubling it up", () => {
  const fromBlockId = state().addBlock("leaf");
  const toBlockId = state().addBlock("leaf");
  if (fromBlockId === undefined || toBlockId === undefined) {
    throw new Error("expected blocks to be added");
  }

  const first = state().connectJacks(`${fromBlockId}:out`, `${toBlockId}:in`);
  const second = state().connectJacks(`${fromBlockId}:out`, `${toBlockId}:in`);

  expect(second).toBe(first);
  expect(Object.keys(state().patches)).toHaveLength(1);
  const rootBlock = root();
  if (rootBlock.type !== "tree") throw new Error("root is not a tree");
  expect(rootBlock.patches).toEqual([first]);
});

test("rejects invalid jack connections", () => {
  const blockId = state().addBlock("leaf");
  if (blockId === undefined) throw new Error("expected block to be added");

  expect(state().connectJacks(`${blockId}:in`, `${blockId}:out`)).toBe(
    undefined,
  );
  expect(state().connectJacks(`${blockId}:out`, `${blockId}:in`)).toBe(
    undefined,
  );
  expect(state().connectJacks(`${blockId}:out`, "nobody:in")).toBe(undefined);
  expect(state().patches).toEqual({});
});

test("refuses up front the connections it would reject", () => {
  const fromBlockId = state().addBlock("leaf");
  const toBlockId = state().addBlock("leaf");
  if (fromBlockId === undefined || toBlockId === undefined) {
    throw new Error("expected blocks to be added");
  }

  expect(state().canConnectJacks(`${fromBlockId}:out`, `${toBlockId}:in`)).toBe(
    true,
  );
  expect(state().canConnectJacks(`${fromBlockId}:in`, `${toBlockId}:out`)).toBe(
    false,
  );
  expect(
    state().canConnectJacks(`${fromBlockId}:out`, `${fromBlockId}:in`),
  ).toBe(false);
  expect(state().patches).toEqual({});
});

test("hands back the id of the block it added", () => {
  const id = state().addBlock("leaf");

  expect(id).toBeTypeOf("string");
  expect(children()).toEqual([id]);
});

test("leaves the rack alone when run is called", () => {
  state().addBlock("leaf");
  const before = state().blocks;

  state().run();

  expect(state().blocks).toBe(before);
});

test("removes a block with its jacks and the patches wired to it", () => {
  const first = state().addBlock("leaf");
  const second = state().addBlock("leaf");
  const third = state().addBlock("tree");
  if (first === undefined || second === undefined || third === undefined)
    throw new Error("blocks not added");

  const cut = state().connectJacks(`${first}:out`, `${second}:in`);
  const kept = state().connectJacks(`${second}:out`, `${third}:in`);
  if (cut === undefined || kept === undefined)
    throw new Error("patches not made");

  state().removeBlocks([first]);

  expect(children()).toEqual([second, third]);
  expect(state().blocks[first]).toBeUndefined();
  expect(state().jacks[`${first}:in`]).toBeUndefined();
  expect(state().jacks[`${first}:out`]).toBeUndefined();
  expect(state().patches[cut]).toBeUndefined();
  expect(state().patches[kept]).toBeDefined();

  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  expect(block.patches).toEqual([kept]);
});

test("removes several blocks at once", () => {
  const first = state().addBlock("leaf");
  const second = state().addBlock("tree");
  if (first === undefined || second === undefined)
    throw new Error("blocks not added");

  state().removeBlocks([first, second]);

  expect(children()).toEqual([]);
  expect(state().jacks).toEqual({});
});

test("never removes the root or blocks it does not hold", () => {
  state().addBlock("leaf");
  const before = state();

  state().removeBlocks([before.rootId, "no-such-block"]);

  expect(state()).toBe(before);
});

test("removes a patch and leaves its blocks and jacks", () => {
  const first = state().addBlock("leaf");
  const second = state().addBlock("leaf");
  if (first === undefined || second === undefined)
    throw new Error("blocks not added");

  const patch = state().connectJacks(`${first}:out`, `${second}:in`);
  if (patch === undefined) throw new Error("patch not made");

  state().removePatches([patch]);

  expect(state().patches[patch]).toBeUndefined();
  expect(children()).toEqual([first, second]);
  expect(state().jacks[`${first}:out`]).toBeDefined();

  const block = root();
  if (block.type !== "tree") throw new Error("root is not a tree");
  expect(block.patches).toEqual([]);
});

test("ignores patches the root does not hold", () => {
  state().addBlock("leaf");
  const before = state();

  state().removePatches(["no-such-patch"]);

  expect(state()).toBe(before);
});

test("lists every category", () => {
  expect(state().categories()).toEqual(["source"]);
});

test("lists the sub categories of a category", () => {
  expect(state().subCategories("source")).toEqual([{ name: "AMOscillator" }]);
});

test("has no sub categories for an unknown category", () => {
  expect(state().subCategories("nope")).toEqual([]);
});
