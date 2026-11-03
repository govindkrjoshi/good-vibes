import { expect, test } from "./fixtures";
import { addBlock } from "./helpers";

const panels = (page: import("@playwright/test").Page) =>
  page.getByTestId("rack-node");

test("adds each category's usual item from its button", async ({ page }) => {
  await page.getByTestId("add-source").click();
  await page.getByTestId("add-effect").click();
  await page.getByTestId("add-component").click();
  await page.getByTestId("add-signal").click();

  await expect(panels(page)).toHaveCount(4);
  for (const name of ["Oscillator", "FeedbackDelay", "Filter", "LFO"]) {
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
});

test("adds a picked item, and its category's button adds it after", async ({
  page,
}) => {
  await addBlock(page, "effects", "tone/Chorus");
  await expect(page.getByRole("heading", { name: "Chorus" })).toHaveCount(1);

  await page.getByTestId("add-effect").click();
  await expect(page.getByRole("heading", { name: "Chorus" })).toHaveCount(2);
});

test("gives a patchable param a jack of its own", async ({ page }) => {
  await page.getByTestId("add-component").click();

  const jacks = panels(page).getByTestId("jacks-in").getByTestId("jack");
  await expect(jacks).toHaveText(["Input", "Frequency", "Q"]);
});

test("draws a meter's readout on its panel", async ({ page }) => {
  await addBlock(page, "components", "tone/Meter");

  await expect(
    panels(page).getByRole("img", { name: "Level meter" }),
  ).toBeVisible();
});
