import { expect, test } from "./fixtures";
import { blockAt, blocks, boxOf, drag, toolbar } from "./helpers";

test("toggles the lock between its two states", async ({ page }) => {
  const lock = page.getByTestId("toggle-lock");
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await expect(lock).toHaveAttribute("aria-label", "Lock canvas");

  await lock.click();
  await expect(toolbar(page)).toMatchAriaSnapshot(`
    - toolbar "Rack tools":
      - button "Unlock canvas" [pressed]
  `);

  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await expect(lock).toHaveAttribute("aria-label", "Lock canvas");
});

test("keeps a locked block where it is", async ({ page }) => {
  await page.getByTestId("add-source").click();
  const before = await boxOf(blocks(page).first(), "block");

  await page.getByTestId("toggle-lock").click();
  const at = await blockAt(page);
  await drag(page, before, 120, 60);

  expect(await blockAt(page)).toBe(at);
});
