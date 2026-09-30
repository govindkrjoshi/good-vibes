import { expect, test } from "./fixtures";
import { boxOf, canvas, island, toolbar } from "./helpers";

test("floats an island in each corner around the canvas", async ({ page }) => {
  const corners = {
    "canvas-menu": { top: true, left: true },
    "zoom-out": { top: false, left: true },
    help: { top: false, left: false },
  } as const;

  // Every box is re-read together inside one retrying block: boundingBox() is a
  // single read against whatever the layout happens to be at that instant, so
  // comparing two of them is only sound once both have stopped moving.
  await expect(async () => {
    const canvasBox = await boxOf(canvas(page), "canvas");

    for (const [testId, corner] of Object.entries(corners)) {
      const box = await boxOf(island(page, testId), testId);

      // Floating means overlapping the canvas rather than sitting beside it.
      expect(box.y).toBeGreaterThan(canvasBox.y);
      expect(box.y + box.height).toBeLessThan(canvasBox.y + canvasBox.height);

      expect(box.y < canvasBox.y + canvasBox.height / 2).toBe(corner.top);
      expect(box.x < canvasBox.x + canvasBox.width / 2).toBe(corner.left);
    }
  }).toPass();
});

test("centres the tool island at the top of the canvas", async ({ page }) => {
  await expect(async () => {
    const canvasBox = await boxOf(canvas(page), "canvas");
    const barBox = await boxOf(toolbar(page), "toolbar");

    const barCentre = barBox.x + barBox.width / 2;
    const canvasCentre = canvasBox.x + canvasBox.width / 2;
    expect(Math.abs(barCentre - canvasCentre)).toBeLessThan(2);
    expect(barBox.y).toBeLessThan(canvasBox.y + canvasBox.height / 2);
  }).toPass();
});
