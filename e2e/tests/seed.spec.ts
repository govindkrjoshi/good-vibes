import { expect, test } from "./fixtures";
import { toolbar } from "./helpers";

test("seed", async ({ page }) => {
  await expect(toolbar(page)).toBeVisible();
});
