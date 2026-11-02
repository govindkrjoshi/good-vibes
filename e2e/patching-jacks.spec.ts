import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { blocks, boxOf, canvas, connect, dragExactly } from "./helpers";

const edges = (page: Page) => page.locator(".react-flow__edge");
const panel = (page: Page) => page.getByTestId("rack-node");
const tree = (page: Page) => page.getByTestId("tree-node");

const socket = (rack: Locator, direction: "in" | "out") =>
  rack.locator(`[data-handleid$=":${direction}"]`);

const insideSocket = (direction: "in" | "out") => (rack: Locator) =>
  rack.getByTestId(`jacks-${direction}`).locator('[data-handleid^="inside:"]');

const outerSocket = (direction: "in" | "out") => (rack: Locator) =>
  rack
    .getByTestId(`jacks-${direction}`)
    .locator('.react-flow__handle:not([data-handleid^="inside:"])');

// A synth with a Destination clear of it for each count asked for. Racks all
// start in the same spot.
async function synthAndDestinations(page: Page, count: number) {
  await page.getByTestId("add-instrument").click();
  await expect(panel(page)).toBeVisible();
  for (let index = 0; index < count; index += 1) {
    await page.getByTestId("add-destination").click();
    await expect(blocks(page)).toHaveCount(index + 1);
    await dragExactly(
      page,
      await boxOf(blocks(page).nth(index), "block"),
      500,
      index * 150,
    );
  }
}

// A group with an input and an output, holding a synth.
async function groupAroundSynth(page: Page) {
  await page.getByTestId("add-group").click();
  await tree(page).getByRole("button", { name: "Add input to Group" }).click();
  await tree(page).getByRole("button", { name: "Add output to Group" }).click();
  // Those clicks selected the group, which would lift it over the new rack.
  await canvas(page).click({ position: { x: 5, y: 5 } });
  await page.getByTestId("add-instrument").click();
  await expect(panel(page)).toBeVisible();
  await dragExactly(
    page,
    await boxOf(panel(page).getByRole("heading").first(), "header"),
    0,
    150,
  );
  await expect(tree(page)).toHaveText(/1 rack/);
}

test("patches an output into an input", async ({ page }) => {
  await synthAndDestinations(page, 1);

  expect(
    await connect(page, socket(panel(page), "out"), socket(blocks(page), "in")),
  ).toBe(true);

  await expect(edges(page)).toHaveCount(1);
});

test("a jack takes many patches, but one per pair of jacks", async ({
  page,
}) => {
  await synthAndDestinations(page, 2);
  const output = socket(panel(page), "out");

  await connect(page, output, socket(blocks(page).nth(0), "in"));
  await connect(page, output, socket(blocks(page).nth(1), "in"));
  await expect(edges(page)).toHaveCount(2);

  await connect(page, output, socket(blocks(page).nth(0), "in"));
  await expect(edges(page)).toHaveCount(2);
});

test("patches a group's jacks to the rack inside it", async ({ page }) => {
  await groupAroundSynth(page);

  expect(
    await connect(
      page,
      insideSocket("in")(tree(page)),
      socket(panel(page), "in"),
    ),
  ).toBe(true);
  await expect(edges(page)).toHaveCount(1);

  expect(
    await connect(
      page,
      socket(panel(page), "out"),
      insideSocket("out")(tree(page)),
    ),
  ).toBe(true);
  await expect(edges(page)).toHaveCount(2);
});

test("refuses a child patched to the outside of its group", async ({
  page,
}) => {
  await groupAroundSynth(page);

  expect(
    await connect(
      page,
      socket(panel(page), "out"),
      outerSocket("in")(tree(page)),
    ),
  ).toBe(false);

  await expect(edges(page)).toHaveCount(0);
});

test("refuses a patch into a rack in another group", async ({ page }) => {
  await groupAroundSynth(page);
  await page.getByTestId("add-destination").click();
  await expect(blocks(page)).toHaveCount(1);
  await dragExactly(page, await boxOf(blocks(page), "block"), 600, 0);

  expect(
    await connect(page, socket(panel(page), "out"), socket(blocks(page), "in")),
  ).toBe(false);

  await expect(edges(page)).toHaveCount(0);
});

test("selects a patch inside a group and deletes it", async ({ page }) => {
  await groupAroundSynth(page);
  await connect(
    page,
    insideSocket("in")(tree(page)),
    socket(panel(page), "in"),
  );
  await expect(edges(page)).toHaveCount(1);

  // A cable between sockets facing different ways isn't symmetric, so the
  // middle of its box can miss it. The middle of its length can't.
  const middle = await page
    .locator(".react-flow__edge-path")
    .evaluate((node: SVGPathElement) => {
      const point = node.getPointAtLength(node.getTotalLength() / 2);
      const { x, y } = point.matrixTransform(node.getScreenCTM() ?? undefined);
      return { x, y };
    });
  await page.mouse.click(middle.x, middle.y);
  await expect(edges(page)).toHaveClass(/selected/);
  await page.keyboard.press("Backspace");

  await expect(edges(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
});

test("a locked canvas can't be patched", async ({ page }) => {
  await synthAndDestinations(page, 1);
  await page.getByTestId("toggle-lock").click();

  await connect(page, socket(panel(page), "out"), socket(blocks(page), "in"));

  await expect(edges(page)).toHaveCount(0);
});
