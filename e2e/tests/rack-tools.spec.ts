import { expect, test } from "./fixtures";
import { toolbar } from "./helpers";

test("names and groups every rack tool", async ({ page }) => {
  // One snapshot in place of a visibility check per button: it pins the roles
  // and the grouping too, so a tool that loses its label or drifts out of the
  // "Add blocks" group fails here rather than passing on being visible.
  await expect(toolbar(page)).toMatchAriaSnapshot(`
    - toolbar "Rack tools":
      - button "Lock canvas"
      - separator
      - group "Add blocks":
        - button "Add node"
        - button "Add group"
  `);
});

test("puts the rack's own actions outside the tool island", async ({
  page,
}) => {
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Canvas menu" })).toBeVisible();
});

test("hints at what a tool does on hover", async ({ page }) => {
  await page.getByTestId("add-node").hover();

  // Base UI renders the popup without a tooltip role, so key off its slot.
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    "Add node",
  );
});
