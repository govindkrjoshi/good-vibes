import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function openEditor(page: Page, panel: Locator, action: string) {
  await panel.getByRole("button", { name: "Add event" }).click();
  const form = page.getByRole("dialog", { name: "Add event" });
  await form.getByRole("combobox", { name: "Action" }).click();
  await page.getByRole("option", { name: action, exact: true }).click();
  return form;
}

test("schedules a method as a sequence, edits a step and removes it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.getByTestId("add-instrument").click();
  const panel = page.getByTestId("rack-node");
  await expect(panel).toHaveCount(1);

  const form = await openEditor(page, panel, "Trigger Attack Release");
  await expect(form.getByRole("button", { name: "Sequence" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await form.getByRole("spinbutton", { name: "Steps" }).fill("4");
  await form.getByRole("textbox", { name: /^Note/ }).fill("C2");
  await form.getByRole("textbox", { name: /^Duration/ }).fill("8n");
  await form.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(form).toBeHidden();

  await expect(panel.getByTestId("event-row")).toHaveCount(2);
  const row = panel.getByTestId("event-row").last();
  const steps = row
    .getByRole("group", { name: "Trigger Attack Release steps" })
    .getByRole("button");
  await expect(steps).toHaveCount(4);
  for (const step of await steps.all()) {
    await expect(step).toHaveAttribute("aria-pressed", "true");
  }

  await row
    .getByRole("button", { name: "Play Trigger Attack Release" })
    .click();
  expect(errors).toEqual([]);

  const second = row.getByRole("button", { name: "Step 2" });
  await second.click();
  await expect(second).toHaveAttribute("aria-pressed", "false");

  await row
    .getByRole("button", { name: "Remove Trigger Attack Release event" })
    .click();
  await expect(panel.getByTestId("event-row")).toHaveCount(1);
});

test("schedules a pattern and a part", async ({ page }) => {
  await page.getByTestId("add-instrument").click();
  const panel = page.getByTestId("rack-node");
  await expect(panel).toHaveCount(1);

  const pattern = await openEditor(page, panel, "Set Note");
  await pattern.getByRole("button", { name: "Pattern" }).click();
  await pattern.getByRole("textbox", { name: "Notes" }).fill("C3 E3 G3");
  await pattern.getByRole("combobox", { name: "Order" }).click();
  await page.getByRole("option", { name: "upDown", exact: true }).click();
  await pattern.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(pattern).toBeHidden();

  const rows = panel.getByTestId("event-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("upDown");

  const part = await openEditor(page, panel, "Trigger Attack Release");
  await part.getByRole("button", { name: "Part" }).click();
  await part.getByRole("textbox", { name: "Steps" }).fill("0:0 C3\n0:2 E3");
  await part.getByRole("textbox", { name: /^Duration/ }).fill("8n");
  await part.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(part).toBeHidden();

  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText("2 steps");
});
