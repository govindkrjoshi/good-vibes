import { expect, test } from "./fixtures";
import { blocks } from "./helpers";

test("adds a block from the keyboard", async ({ page }) => {
  await page.keyboard.press("s");
  await page.keyboard.press("g");

  await expect(blocks(page)).toHaveCount(2);
});

test("moves focus across the tool island with the arrow keys", async ({
  page,
}) => {
  const addDestination = page.getByTestId("add-destination");

  await addDestination.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("add-group")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(addDestination).toBeFocused();
});

test("lists every shortcut behind the help button", async ({ page }) => {
  await page.getByTestId("help").click();

  await expect(page.getByRole("dialog")).toMatchAriaSnapshot(`
    - dialog:
      - heading "Keyboard shortcuts" [level=2]
      - term: Add group
      - definition: G
      - term: Add source
      - definition: S
      - term: Add instrument
      - definition: I
      - term: Add effect
      - definition: E
      - term: Add component
      - definition: C
      - term: Add signal
      - definition: L
      - term: Add event
      - definition: V
      - term: Add destination
      - definition: D
      - term: Delete selection
      - definition: ⌫
      - term: Run rack
      - definition: R
  `);
});
