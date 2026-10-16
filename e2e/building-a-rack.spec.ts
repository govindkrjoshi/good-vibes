import { expect, test } from "./fixtures";
import {
  blockAt,
  blocks,
  boxOf,
  canvas,
  connect,
  drag,
  handle,
} from "./helpers";

test("renders each added block on the canvas", async ({ page }) => {
  await expect(blocks(page)).toHaveCount(0);

  await page.getByTestId("add-source").click();
  await expect(blocks(page)).toHaveCount(1);
  await expect(blocks(page).first().getByRole("heading")).toHaveText("Leaf");

  await page.getByTestId("add-group").click();
  await expect(blocks(page)).toHaveCount(2);
  await expect(blocks(page).last().getByRole("heading")).toHaveText("Group");
});

test("drops each new block inside the visible canvas", async ({ page }) => {
  for (let index = 0; index < 3; index += 1) {
    await page.getByTestId("add-source").click();
    await expect(blocks(page)).toHaveCount(index + 1);

    await expect(async () => {
      const canvasBox = await boxOf(canvas(page), "canvas");
      const box = await boxOf(blocks(page).nth(index), `block ${index}`);

      expect(box.x).toBeGreaterThanOrEqual(canvasBox.x);
      expect(box.y).toBeGreaterThanOrEqual(canvasBox.y);
      expect(box.x + box.width).toBeLessThanOrEqual(
        canvasBox.x + canvasBox.width,
      );
      expect(box.y + box.height).toBeLessThanOrEqual(
        canvasBox.y + canvasBox.height,
      );
    }).toPass();
  }
});

test("stacks no two blocks on the same spot", async ({ page }) => {
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-source").click();
  await expect(blocks(page)).toHaveCount(2);

  await expect(async () => {
    const first = await boxOf(blocks(page).first(), "first block");
    const second = await boxOf(blocks(page).last(), "second block");

    expect({ x: first.x, y: first.y }).not.toEqual({
      x: second.x,
      y: second.y,
    });
  }).toPass();
});

test("drags a block to a new spot on the canvas", async ({ page }) => {
  await page.getByTestId("add-source").click();
  const block = blocks(page).first();
  const before = await boxOf(block, "block");

  const at = await blockAt(page);
  await drag(page, before, 120, 60);

  await expect(async () => {
    expect(await blockAt(page)).not.toBe(at);
    const after = await boxOf(block, "block");
    expect(after.x - before.x).toBeGreaterThan(100);
    expect(after.y - before.y).toBeGreaterThan(40);
  }).toPass();
});

test("patches one block's output into another block's input", async ({
  page,
}) => {
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-source").click();
  await expect(blocks(page)).toHaveCount(2);

  expect(
    await connect(page, handle(page, 0, "out"), handle(page, 1, "in")),
  ).toBe(true);

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("lays no second patch over the first across the same two jacks", async ({
  page,
}) => {
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-source").click();
  await expect(blocks(page)).toHaveCount(2);

  await connect(page, handle(page, 0, "out"), handle(page, 1, "in"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await connect(page, handle(page, 0, "out"), handle(page, 1, "in"));

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("refuses to patch a block's output back into its own input", async ({
  page,
}) => {
  await page.getByTestId("add-source").click();
  await expect(blocks(page)).toHaveCount(1);

  expect(
    await connect(page, handle(page, 0, "out"), handle(page, 0, "in")),
  ).toBe(false);

  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
});
