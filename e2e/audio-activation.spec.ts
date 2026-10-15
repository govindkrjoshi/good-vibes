import { expect, test } from "./fixtures";
import { buildRiff, expectPlaying, open } from "./audio";

// As browsers ship: audio needs a gesture. Run is a gesture in the app, not
// in the frame.
test.use({
  launchOptions: { args: ["--autoplay-policy=user-gesture-required"] },
});

// Chromium lets the app delegate autoplay to the frame (allow="autoplay"),
// so the app's Run starts it there.
test("starts audio in the frame from Run in the app", async ({ page }) => {
  await open(page, false);
  await buildRiff(page);

  await page.getByTestId("run-rack").click();

  await expectPlaying(page);
  await expect(page.locator('iframe[title="Code sandbox"]')).toBeHidden();
});

test("asks for a click in the frame when Run cannot start audio", async ({
  page,
}) => {
  await open(page, true);
  await buildRiff(page);
  const iframe = page.locator('iframe[title="Code sandbox"]');
  const start = page
    .frameLocator('iframe[title="Code sandbox"]')
    .getByRole("button", { name: "Click to start audio" });

  await page.getByTestId("run-rack").click();

  await expect(iframe).toBeVisible();
  await start.click();

  await expect(iframe).toBeHidden();
  await expectPlaying(page);
});
