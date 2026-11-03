import { expect, test } from "./fixtures";
import { addBlock } from "./helpers";

const panels = (page: import("@playwright/test").Page) =>
  page.getByTestId("rack-node");

test("drops the catalogue down from the search bar", async ({ page }) => {
  await page.getByTestId("catalogue-search").click();

  await expect(page.getByRole("listbox", { name: "Modules" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Modules" })).toHaveCount(0);
});

test("adds a module picked from a category", async ({ page }) => {
  await addBlock(page, "effects", "tone/Chorus");

  await expect(page.getByRole("heading", { name: "Chorus" })).toHaveCount(1);
});

test("finds a module by what it does and adds it from the keyboard", async ({
  page,
}) => {
  await page.keyboard.press("/");
  await page.keyboard.type("echo");
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { name: "FeedbackDelay", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Modules" })).toHaveCount(0);
});

test("gives a patchable param a jack of its own", async ({ page }) => {
  await addBlock(page, "components", "tone/Filter");

  const jacks = panels(page).getByTestId("jacks-in").getByTestId("jack");
  await expect(jacks).toHaveText(["Input", "Frequency", "Q"]);
});

test("draws a meter's readout on its panel", async ({ page }) => {
  await addBlock(page, "components", "tone/Meter");

  await expect(
    panels(page).getByRole("img", { name: "Level meter" }),
  ).toBeVisible();
});

test("clears the canvas once it is confirmed", async ({ page }) => {
  await addBlock(page, "effects", "tone/Chorus");
  await page.getByTestId("add-destination").click();

  await page.getByTestId("clear-canvas").click();
  await page.getByTestId("confirm-clear").click();

  await expect(page.locator(".react-flow__node")).toHaveCount(0);
  await expect(page.getByTestId("clear-canvas")).toBeDisabled();
});
