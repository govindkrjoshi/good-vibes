import { expect, test } from "./fixtures";

test("adds a block from the keyboard", async ({ page }) => {
  await page.keyboard.press("d");
  await page.keyboard.press("g");

  await expect(page.getByTestId("block-node")).toHaveCount(1);
  await expect(page.getByTestId("tree-node")).toHaveCount(1);
});

test("moves focus across the tool island with the arrow keys", async ({
  page,
}) => {
  const addGroup = page.getByTestId("add-group");

  await addGroup.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("add-destination")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(addGroup).toBeFocused();
});

test("lists every shortcut behind the help button", async ({ page }) => {
  await page.getByTestId("help").click();

  await expect(page.getByRole("dialog")).toMatchAriaSnapshot(`
    - dialog:
      - heading "Keyboard shortcuts" [level=2]
      - term: Find a module
      - definition: /
      - term: Add group
      - definition: G
      - term: Add destination
      - definition: D
      - term: Delete selection
      - definition: ⌫
  `);
});
