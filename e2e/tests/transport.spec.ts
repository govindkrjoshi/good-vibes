import { expect, test } from "./fixtures";

test("sets the tempo, then runs and stops the rack", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const bpm = page.getByLabel("BPM");
  await bpm.fill("90");
  await bpm.press("Enter");
  await expect(bpm).toHaveValue("90");

  await page.getByTestId("run-rack").click();
  await page.getByTestId("stop-rack").click();

  await expect(page.getByTestId("run-rack")).toBeVisible();
  await expect(page.getByTestId("stop-rack")).toBeVisible();
  expect(errors).toEqual([]);
});
