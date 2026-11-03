import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const chat = (page: Page) => page.getByTestId("chat-panel");

// The fake model answers the first prompt with tool calls and the second
// request, after their results, with words.
test.use({
  openRouterReplies: [
    {
      toolCalls: [
        { name: "add_rack", args: { item: "tone/MonoSynth", id: "bass" } },
        { name: "add_rack", args: { item: "tone/Destination", id: "out" } },
        { name: "connect", args: { from: "bass:out", to: "out:in" } },
        { name: "connect", args: { from: "bass:out", to: "nowhere:in" } },
      ],
    },
    "A bass is playing into the speakers.",
  ],
});

test("builds the rack the agent asks for and shows what it did", async ({
  page,
}) => {
  await page.getByTestId("chat-input").fill("give me a bass");
  await page.getByTestId("chat-input").press("Enter");

  await expect(
    page.getByRole("heading", { name: "MonoSynth", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Destination", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  const rows = chat(page).locator('[data-kind="tool"]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText(
    "Added [bass] MonoSynth from tone/MonoSynth in root.",
  );
  await expect(rows.nth(2)).toContainText("Patched");
  await expect(rows.nth(3)).toContainText("There is no jack nowhere:in");
  await expect(chat(page)).toContainText(
    "A bass is playing into the speakers.",
  );
});
