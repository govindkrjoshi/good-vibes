import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  addBlock,
  blocks,
  boxOf,
  canvas,
  dragExactly as drag,
  settle,
} from "./helpers";

const trees = (page: Page) => page.getByTestId("tree-node");

// The canvas lays the rack out beside the group, not in it.
async function addGroupAndDestination(page: Page) {
  await page.getByTestId("add-group").click();
  await expect(trees(page)).toHaveText(/Drag a rack here/);
  await page.getByTestId("add-destination").click();
  await expect(blocks(page)).toHaveCount(1);
  await settle(page);
  await expect(trees(page)).toHaveText(/Drag a rack here/);
}

type Box = Awaited<ReturnType<typeof boxOf>>;

const holds = (outer: Box, inner: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

test("adds an empty group that invites racks in", async ({ page }) => {
  await page.getByTestId("add-group").click();

  await expect(trees(page)).toHaveText(/Drag a rack here/);
});

test("drags a rack into a group and back out", async ({ page }) => {
  await addGroupAndDestination(page);
  const tree = await boxOf(trees(page), "tree");
  const block = await boxOf(blocks(page), "block");
  const from = { x: block.x + block.width / 2, y: block.y + block.height / 2 };
  const to = {
    x: tree.x + tree.width / 2,
    y: tree.y + tree.height / 2,
  };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 3, from.y);
  await page.mouse.move(to.x + 3, to.y, { steps: 10 });
  await expect(trees(page)).toHaveText(/Drop to add to Group/);
  await page.mouse.up();

  await expect(trees(page)).toHaveText(/1 rack/);
  await expect(trees(page)).not.toHaveText(/Drag a rack here/);

  // The canvas lays the rack out inside the group it was dropped in.
  await settle(page);
  const dropped = await boxOf(blocks(page), "block");
  expect(holds(await boxOf(trees(page), "tree"), dropped)).toBe(true);

  const grown = await boxOf(trees(page), "tree");
  await drag(
    page,
    dropped,
    grown.x + grown.width + 100 - (dropped.x + dropped.width / 2),
    0,
  );

  await expect(trees(page)).toHaveText(/Drag a rack here/);
  await settle(page);
  expect(
    holds(await boxOf(trees(page), "tree"), await boxOf(blocks(page), "block")),
  ).toBe(false);
});

test("a group carries the racks inside it", async ({ page }) => {
  await addGroupAndDestination(page);
  const tree = await boxOf(trees(page), "tree");
  const block = await boxOf(blocks(page), "block");
  await drag(
    page,
    block,
    tree.x + tree.width / 2 - (block.x + block.width / 2),
    tree.y + tree.height / 2 - (block.y + block.height / 2),
  );
  await expect(trees(page)).toHaveText(/1 rack/);
  await settle(page);
  const inside = await boxOf(blocks(page), "block");

  const header = await boxOf(trees(page).getByRole("heading"), "header");
  await drag(page, header, 100, 80);

  await expect(async () => {
    const moved = await boxOf(blocks(page), "block");
    expect(Math.abs(moved.x - inside.x - 100)).toBeLessThan(2);
    expect(Math.abs(moved.y - inside.y - 80)).toBeLessThan(2);
  }).toPass();
});

test("a group grows to fit a panel dropped inside it", async ({ page }) => {
  await page.getByTestId("add-group").click();
  await expect(trees(page)).toHaveCount(1);
  await addBlock(page, "instruments", "tone/AMSynth");
  const panel = page.getByTestId("rack-node");
  await expect(panel).toBeVisible();

  const tree = await boxOf(trees(page), "tree");
  const moved = await boxOf(panel.getByRole("heading").first(), "header");
  await drag(
    page,
    moved,
    tree.x + tree.width - 60 - (moved.x + moved.width / 2),
    tree.y + 90 - (moved.y + moved.height / 2),
  );

  await expect(trees(page)).toHaveText(/1 rack/);
  await settle(page);
  const grown = await boxOf(trees(page), "tree");
  // The view is fitted again, so the sizes are compared at one zoom.
  expect(grown.height / grown.width).toBeGreaterThan(tree.height / tree.width);
  expect(holds(grown, await boxOf(panel, "panel"))).toBe(true);
});

test("nests a group in a group but not in itself", async ({ page }) => {
  await page.getByTestId("add-group").click();
  await expect(trees(page)).toHaveCount(1);
  await page.getByTestId("add-group").click();
  await expect(trees(page)).toHaveCount(2);
  // The canvas lays the second group out beside the first.
  await settle(page);

  const [a, b] = [
    await boxOf(trees(page).first(), "first"),
    await boxOf(trees(page).nth(1).getByRole("heading"), "second header"),
  ];
  await drag(
    page,
    b,
    a.x + a.width / 2 - (b.x + b.width / 2),
    a.y + 100 - (b.y + b.height / 2),
  );

  await expect(trees(page).first()).toHaveText(/1 rack/);

  // Dropping a tree on itself leaves it where it is.
  const inner = await boxOf(trees(page).nth(1).getByRole("heading"), "inner");
  await drag(page, inner, 10, 10);
  await expect(trees(page).first()).toHaveText(/1 rack/);
  await expect(canvas(page)).toBeVisible();
});

test("adds and removes a group's jacks", async ({ page }) => {
  await page.getByTestId("add-group").click();
  const tree = trees(page);
  // The sockets on the frame, without the ones facing inside it.
  const handles = tree.locator(
    '.react-flow__handle:not([data-handleid^="inside:"])',
  );
  await expect(handles).toHaveCount(0);

  await tree.getByRole("button", { name: "Add input to Group" }).click();
  await tree.getByRole("button", { name: "Add input to Group" }).click();
  await tree.getByRole("button", { name: "Add output to Group" }).click();

  await expect(tree.getByTestId("jacks-in")).toContainText("In 1");
  await expect(tree.getByTestId("jacks-in")).toContainText("In 2");
  await expect(tree.getByTestId("jacks-out")).toContainText("Out 1");
  await expect(handles).toHaveCount(3);

  // Each sits on the edge of the frame, beside its own label.
  const frame = await boxOf(tree, "tree");
  const [first, second, output] = [
    await boxOf(handles.nth(0), "first input"),
    await boxOf(handles.nth(1), "second input"),
    await boxOf(handles.nth(2), "output"),
  ];
  expect(Math.abs(first.x + first.width / 2 - frame.x)).toBeLessThan(2);
  expect(second.y).toBeGreaterThan(first.y);
  expect(
    Math.abs(output.x + output.width / 2 - (frame.x + frame.width)),
  ).toBeLessThan(2);

  await tree.getByTestId("jack").first().hover();
  await tree.getByRole("button", { name: "Remove In 1 from Group" }).click();

  await expect(handles).toHaveCount(2);
  await expect(tree.getByTestId("jacks-in")).not.toContainText("In 1");
});

test("a locked group's jacks can't change", async ({ page }) => {
  await page.getByTestId("add-group").click();
  const tree = trees(page);
  await tree.getByRole("button", { name: "Add input to Group" }).click();
  await expect(tree.getByTestId("jack")).toHaveCount(1);

  await page.getByTestId("toggle-lock").click();

  await expect(tree.getByRole("button")).toHaveCount(0);
  await expect(tree.getByTestId("jack")).toHaveCount(1);
});

test("jacks look the same on every kind of rack", async ({ page }) => {
  await page.getByTestId("add-group").click();
  const tree = trees(page);
  await tree.getByRole("button", { name: "Add input to Group" }).click();
  await tree.getByRole("button", { name: "Add output to Group" }).click();
  await page.getByTestId("add-destination").click();
  await addBlock(page, "instruments", "tone/AMSynth");
  await settle(page);
  const racks = [tree, blocks(page), page.getByTestId("rack-node")];

  const looks = await Promise.all(
    racks.map(async (rack) => {
      const row = rack.getByTestId("jack").first();
      const socket = row.locator(".react-flow__handle").first();
      const size = await boxOf(socket, "socket");
      // The canvas is fitted to the racks, so sizes come at whatever zoom.
      const round = (value: number) => Math.round(value * 100) / 100;
      return {
        size: [round(size.width), round(size.height)],
        height: round((await boxOf(row, "row")).height),
        border: await socket.evaluate((node) => getComputedStyle(node).border),
        label: await row.evaluate((node) => getComputedStyle(node).fontSize),
      };
    }),
  );

  expect(looks[1]).toEqual(looks[0]);
  expect(looks[2]).toEqual(looks[0]);
  await expect(blocks(page).getByTestId("jacks-in")).toContainText("Input");
});
