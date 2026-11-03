import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  addBlock,
  blocks,
  boxOf,
  canvas,
  connect,
  dragExactly,
  settle,
} from "./helpers";

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

// A synth with a Destination for each count asked for, laid out clear of it.
async function synthAndDestinations(page: Page, count: number) {
  await addBlock(page, "instruments", "tone/AMSynth");
  await expect(panel(page)).toBeVisible();
  for (let index = 0; index < count; index += 1) {
    await page.getByTestId("add-destination").click();
    await expect(blocks(page)).toHaveCount(index + 1);
  }
  await settle(page);
}

// A group with an input and an output, holding a synth.
async function groupAroundSynth(page: Page) {
  await page.getByTestId("add-group").click();
  await tree(page).getByRole("button", { name: "Add input to Group" }).click();
  await tree(page).getByRole("button", { name: "Add output to Group" }).click();
  // Those clicks selected the group, which would lift it over the new rack.
  await canvas(page).click({ position: { x: 5, y: 5 } });
  await addBlock(page, "instruments", "tone/AMSynth");
  await expect(panel(page)).toBeVisible();
  const group = await boxOf(tree(page), "tree");
  const header = await boxOf(
    panel(page).getByRole("heading").first(),
    "header",
  );
  await dragExactly(
    page,
    header,
    group.x + group.width / 2 - (header.x + header.width / 2),
    group.y + group.height / 2 - (header.y + header.height / 2),
  );
  await expect(tree(page)).toHaveText(/1 rack/);
  await settle(page);
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
  await settle(page);

  // A cable between sockets facing different ways isn't symmetric, so the
  // middle of its box can miss it. A point along its length can't. The rack
  // sits right under the group's jacks, and the cable bends round behind it
  // to reach its input, so the point is in the gap between them.
  const along = await page
    .locator(".react-flow__edge-path")
    .evaluate((node: SVGPathElement) => {
      const point = node.getPointAtLength(node.getTotalLength() / 4);
      const { x, y } = point.matrixTransform(node.getScreenCTM() ?? undefined);
      return { x, y };
    });
  await page.mouse.click(along.x, along.y);
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
