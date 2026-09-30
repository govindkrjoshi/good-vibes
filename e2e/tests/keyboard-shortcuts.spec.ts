import { expect, test } from "./fixtures";
import { blocks } from "./helpers";

test("adds a block from the keyboard", async ({ page }) => {
  await page.keyboard.press("n");
  await page.keyboard.press("g");

  await expect(blocks(page)).toHaveCount(2);
});

test("moves focus across the tool island with the arrow keys", async ({
  page,
}) => {
  const addNode = page.getByTestId("add-node");

  await addNode.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("add-group")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(addNode).toBeFocused();
});

test("lists every shortcut behind the help button", async ({ page }) => {
  await page.getByTestId("help").click();

  // Base UI gives the popover a dialog role once it opens, so the whole panel
  // can be matched in one go: the keys and the actions they belong to.
  await expect(page.getByRole("dialog")).toMatchAriaSnapshot(`
    - dialog:
      - heading "Keyboard shortcuts" [level=2]
      - term: Add node
      - definition: "N"
      - term: Add group
      - definition: G
      - term: Run rack
      - definition: R
  `);
});
