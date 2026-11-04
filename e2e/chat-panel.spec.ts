import { type Page } from "@playwright/test";
import { expect, test, openSandboxPage } from "./fixtures";
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

test("keeps the conversation across a reload, until a new one is started", async ({
  page,
}) => {
  await page.getByTestId("chat-input").fill("How do I add space?");
  await page.getByTestId("chat-input").press("Enter");
  await expect(chat(page)).toContainText("Try a reverb.");

  // The server renders an empty chat; the kept one must only appear once
  // React has taken over, or hydration fails and the tree is thrown away.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openSandboxPage(page);

  await expect(chat(page)).toContainText("How do I add space?");
  await expect(chat(page)).toContainText("Try a reverb.");
  expect(errors.filter((error) => /hydrat/i.test(error))).toEqual([]);

  await page.getByTestId("chat-new").click();

  await expect(chat(page)).toContainText("Talk to the agent");
  await expect(chat(page).locator("[data-role]")).toHaveCount(0);
  await openSandboxPage(page);
  await expect(chat(page)).toContainText("Talk to the agent");
});

test("keeps each chat's rack with it, across a reload and between chats", async ({
  page,
}) => {
  await page.getByTestId("add-group").click();
  await expect(page.getByTestId("tree-node")).toHaveCount(1);
  await page.getByTestId("chat-input").fill("Keep this group");
  await page.getByTestId("chat-input").press("Enter");
  await expect(chat(page)).toContainText("Try a reverb.");

  await openSandboxPage(page);
  await expect(page.getByTestId("tree-node")).toHaveCount(1);
  await expect(page.getByTestId("chat-picker")).toContainText(
    "Keep this group",
  );

  await page.getByTestId("chat-new").click();
  await expect(page.getByTestId("tree-node")).toHaveCount(0);
  await expect(chat(page)).toContainText("Talk to the agent");

  await page.getByTestId("chat-picker").click();
  await page
    .getByTestId("chat-picker-item")
    .filter({ hasText: "Keep this group" })
    .click();
  await expect(page.getByTestId("tree-node")).toHaveCount(1);
  await expect(chat(page)).toContainText("Keep this group");
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
