import { expect, test } from "./fixtures";

test("shows no debug log normally", async ({ page }) => {
  await expect(page.getByTestId("debug-panel")).toHaveCount(0);
});

test("with ?debug, follows an edit to what the sandbox did with it", async ({
  page,
}) => {
  const hydrated = page.waitForEvent(
    "console",
    (message) => message.text() === "Sandbox loaded",
  );
  await page.goto("/?debug");
  await hydrated;

  await page.getByTestId("add-source").click();

  const revision = page.getByTestId("debug-revision").first();
  await expect(revision).toContainText("rev 1");
  await expect(revision).toContainText("user AddBlock → Committed");
  await expect(revision).toContainText("addBlock block");
  // The frame's answer to the command, then the error it left.
  await expect(revision).toContainText(": LeafThrew");
  await expect(revision).toContainText(/build [\w-]+: LeafThrew/);

  await page.getByRole("button", { name: "Chains" }).click();
  await expect(page.getByTestId("debug-chain")).toHaveCount(0);
});
