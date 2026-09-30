import { expect, test } from "./fixtures";
import { toolbar } from "./helpers";

test("seed", async ({ page }) => {
  // Nothing beyond the fixture's own setup belongs here. This test exists so
  // `playwright test tests/seed.spec.ts --debug=cli` has somewhere to pause:
  // anything exploring the app then starts from the state every other test
  // starts from, rather than from a bare page.goto.
  await expect(toolbar(page)).toBeVisible();
});
