import { expect, test } from "./fixtures";
import { addBlock, blocks, connect, handle } from "./helpers";

test("deletes the selected block and the patches wired to it", async ({
  page,
}) => {
  const remove = page.getByTestId("delete-selection");

  await addBlock(page, "components", "tone/Mono");
  await addBlock(page, "components", "tone/Mono");
  await expect(blocks(page)).toHaveCount(2);
  await connect(page, handle(page, 0, "out"), handle(page, 1, "in"));
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await expect(remove).toBeDisabled();

  await blocks(page).first().click();
  await expect(remove).toBeEnabled();
  await remove.click();

  await expect(blocks(page)).toHaveCount(1);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(remove).toBeDisabled();
});

test("deletes the selected block from the keyboard", async ({ page }) => {
  await addBlock(page, "components", "tone/Mono");
  await blocks(page).first().click();

  await page.keyboard.press("Backspace");

  await expect(blocks(page)).toHaveCount(0);
});

test("keeps a selected block while the canvas is locked", async ({ page }) => {
  await addBlock(page, "components", "tone/Mono");
  await blocks(page).first().click();
  await page.getByTestId("toggle-lock").click();

  await expect(page.getByTestId("delete-selection")).toBeDisabled();
  await page.keyboard.press("Backspace");

  await expect(blocks(page)).toHaveCount(1);
});
