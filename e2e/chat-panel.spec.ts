import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { boxOf, canvas } from "./helpers";

const chat = (page: Page) => page.getByTestId("chat-panel");

test.use({ openRouterReplies: ["Try a reverb."] });

test("docks the chat to the left of the canvas", async ({ page }) => {
  const panel = await boxOf(chat(page), "chat panel");
  const pane = await boxOf(canvas(page), "canvas");

  expect(panel.x).toBe(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(pane.x + 1);
});

test("starts empty, then holds a conversation", async ({ page }) => {
  await expect(chat(page)).toContainText("Talk to the agent");
  await expect(chat(page).locator("[data-role]")).toHaveCount(0);

  await page.getByTestId("chat-input").fill("How do I add space?");
  await page.getByTestId("chat-input").press("Enter");

  await expect(
    chat(page).locator('[data-role="user"]', {
      hasText: "How do I add space?",
    }),
  ).toBeVisible();
  await expect(chat(page)).toContainText("Try a reverb.");
  await expect(page.getByTestId("chat-input")).toHaveValue("");
});

test("typing in the chat leaves the rack shortcuts alone", async ({ page }) => {
  await page.getByTestId("chat-input").fill("");
  await page.getByTestId("chat-input").press("s");

  await expect(page.getByTestId("block-node")).toHaveCount(0);
  await expect(page.getByTestId("chat-input")).toHaveValue("s");
});

test("hiding the chat gives the canvas its width", async ({ page }) => {
  const before = await boxOf(canvas(page), "canvas");

  await page.getByTestId("toggle-chat").click();
  await expect(chat(page)).toBeHidden();
  await expect(async () => {
    const after = await boxOf(canvas(page), "canvas");
    expect(after.width).toBeGreaterThan(before.width);
  }).toPass();

  await page.getByTestId("toggle-chat").click();
  await expect(chat(page)).toBeVisible();
});

test("keeps the transport in the top bar", async ({ page }) => {
  const transport = page.getByRole("group", { name: "Transport" });
  const pane = await boxOf(canvas(page), "canvas");
  const bpm = await boxOf(transport.getByLabel("BPM"), "BPM");

  await expect(transport.getByLabel("BPM")).toBeVisible();
  expect(bpm.y + bpm.height).toBeLessThanOrEqual(pane.y);
});
