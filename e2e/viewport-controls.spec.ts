import { expect, test } from "./fixtures";

test("zooms the canvas from the bottom-left island", async ({ page }) => {
  const level = page.getByTestId("zoom-level");
  await expect(level).toHaveText("100%");

  await page.getByTestId("zoom-in").click();
  await expect(level).not.toHaveText("100%");

  await level.click();
  await expect(level).toHaveText("100%");
});

test("leaves undo and redo disabled until something happens", async ({
  page,
}) => {
  await expect(page.getByTestId("undo")).toBeDisabled();
  await expect(page.getByTestId("redo")).toBeDisabled();
});

test("opens the canvas menu from the top-left island", async ({ page }) => {
  await page.getByTestId("canvas-menu").click();

  await expect(page.getByRole("menu", { name: "Canvas menu" }))
    .toMatchAriaSnapshot(`
    - menu "Canvas menu":
      - menuitem "Fit view"
      - menuitem "Zoom to 100%"
  `);
});
