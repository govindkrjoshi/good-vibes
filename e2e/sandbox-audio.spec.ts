import { expect, test } from "./fixtures";
import { expectPlaying, expectSilent, buildRiff, open, read } from "./audio";

test("runs and stops the rack in the frame, never in the app", async ({
  page,
}) => {
  await open(page, false);
  await buildRiff(page);

  await page.getByTestId("run-rack").click();
  await expectPlaying(page);

  await page.getByTestId("stop-rack").click();
  await expectSilent(page);

  await page.getByTestId("run-rack").click();
  await expectPlaying(page);
  // The app itself builds no audio.
  expect(await read(page)).toBe(0);
  await expect(page.locator('iframe[title="Code sandbox"]')).toBeHidden();
});

test("reports a leaf that fails to build, and plays the rest", async ({
  page,
}) => {
  await open(page, false);
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await buildRiff(page);
  await page.getByTestId("add-source").click();

  await page.getByTestId("run-rack").click();

  await expectPlaying(page);
  expect(warnings.some((text) => text.includes("Leaf has no code"))).toBe(true);
});

test("carries an edit to the running rack over without a new Run", async ({
  page,
}) => {
  await open(page, false);
  await buildRiff(page);
  await page.getByTestId("run-rack").click();
  await expectPlaying(page);

  await page.getByTestId("rack-node").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("rack-node")).toHaveCount(0);

  await expectSilent(page);
});
