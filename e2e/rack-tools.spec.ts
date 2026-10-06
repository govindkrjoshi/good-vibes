import { expect, test } from "./fixtures";
import { toolbar } from "./helpers";

test("names and groups every rack tool", async ({ page }) => {
  await expect(toolbar(page)).toMatchAriaSnapshot(`
    - toolbar "Rack tools":
      - button "Lock canvas"
      - separator
      - group "Add blocks":
        - button "Add source"
        - button "Add instrument"
        - button "Add effect"
        - button "Add component"
        - button "Add signal"
        - button "Add event"
        - button "Add destination"
      - separator
      - group "Add group":
        - button "Add group"
      - separator
      - group "Edit":
        - button "Delete selection" [disabled]
  `);
});

test("puts the rack's own actions outside the tool island", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Canvas menu" })).toBeVisible();
});

test("hints at what a tool does on hover", async ({ page }) => {
  await page.getByTestId("add-source").hover();

  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    "Add source",
  );
});
