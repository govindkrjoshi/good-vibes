import { expect, test, type Page } from "@playwright/test";
import { openSandboxPage } from "./helpers";

const blocks = (page: Page) => page.getByTestId("block-node");

/**
 * Where a block sits on the canvas, read off the node's transform. A screen
 * box cannot tell a moved block from a panned canvas; this can.
 */
const blockAt = (page: Page, index = 0) =>
  page
    .locator(".react-flow__node")
    .nth(index)
    .evaluate((node) => (node as HTMLElement).style.transform);

test("renders each added block on the canvas", async ({ page }) => {
  await openSandboxPage(page);

  await expect(blocks(page)).toHaveCount(0);

  await page.getByTestId("add-node").click();
  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).first()).toHaveText("Node");

  await page.getByTestId("add-group").click();
  await expect(blocks(page)).toHaveCount(2);
  await expect(blocks(page).last()).toHaveText("Group");
});

test("adds a block with the keyboard too", async ({ page }) => {
  await openSandboxPage(page);

  await page.keyboard.press("n");
  await page.keyboard.press("g");

  await expect(blocks(page)).toHaveCount(2);
});

test("drops each new block inside the visible canvas", async ({ page }) => {
  await openSandboxPage(page);

  const canvas = await page.locator(".react-flow__pane").boundingBox();
  if (canvas === null) throw new Error("no canvas box");

  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId("add-node").click();
    await expect(blocks(page)).toHaveCount(index + 1);

    const box = await blocks(page).nth(index).boundingBox();
    if (box === null) throw new Error(`no box for block ${index}`);

    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  }
});

test("stacks no two blocks on the same spot", async ({ page }) => {
  await openSandboxPage(page);

  await page.getByTestId("add-node").click();
  await page.getByTestId("add-node").click();
  await expect(blocks(page)).toHaveCount(2);

  const first = await blocks(page).first().boundingBox();
  const second = await blocks(page).last().boundingBox();
  if (first === null || second === null) throw new Error("no block box");

  expect({ x: first.x, y: first.y }).not.toEqual({ x: second.x, y: second.y });
});

/** Drags from the middle of `box` by `dx`/`dy`, in screen pixels. */
async function drag(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // Raw mouse moves rather than hover(): a locked block takes no pointer
  // events, so Playwright would refuse to target it.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

test("drags a block to a new spot on the canvas", async ({ page }) => {
  await openSandboxPage(page);

  await page.getByTestId("add-node").click();
  const block = blocks(page).first();
  const before = await block.boundingBox();
  if (before === null) throw new Error("no block box");

  const at = await blockAt(page);
  await drag(page, before, 120, 60);

  await expect(async () => {
    expect(await blockAt(page)).not.toBe(at);
    const after = await block.boundingBox();
    if (after === null) throw new Error("no block box");
    expect(after.x - before.x).toBeGreaterThan(100);
    expect(after.y - before.y).toBeGreaterThan(40);
  }).toPass();
});

test("keeps a locked block where it is", async ({ page }) => {
  await openSandboxPage(page);

  await page.getByTestId("add-node").click();
  const block = blocks(page).first();
  const before = await block.boundingBox();
  if (before === null) throw new Error("no block box");

  await page.getByTestId("toggle-lock").click();
  const at = await blockAt(page);
  await drag(page, before, 120, 60);

  // The canvas still pans under a locked block, so only its own spot is fixed.
  expect(await blockAt(page)).toBe(at);
});
