import { expect, test } from "./fixtures";
import { toolbar } from "./helpers";

test("names and groups every rack tool", async ({ page }) => {
  await expect(toolbar(page)).toMatchAriaSnapshot(`
    - toolbar "Rack tools":
      - button "Lock canvas"
      - separator
      - combobox "Find a module"
      - separator
      - group "Add":
        - button "Add group"
        - button "Add destination"
      - separator
      - group "Edit":
        - button "Delete selection" [disabled]
        - button "Clear canvas" [disabled]
      - separator
      - group "Demos":
        - button "Load a demo"
  `);
});

test("puts the rack's own actions outside the tool island", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Canvas menu" })).toBeVisible();
});

test("hints at what a tool does on hover", async ({ page }) => {
  await page.getByTestId("add-group").hover();

  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    "Add group",
  );
});
