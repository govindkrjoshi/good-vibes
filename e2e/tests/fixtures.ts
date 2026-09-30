import { expect, test as base, type Page } from "@playwright/test";
import { toolbar } from "./helpers";

export { expect };

async function openSandboxPage(page: Page) {
  // The toolbar is server-rendered, so it shows up before hydration and cannot
  // gate interaction: a click landing first is silently dropped. The provider's
  // mount log is the signal that handlers are attached.
  const hydrated = page.waitForEvent(
    "console",
    (message) =>
      message.type() === "log" && message.text() === "Sandbox loaded",
  );
  await page.goto("/");
  await hydrated;
  await expect(toolbar(page)).toBeVisible();
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await openSandboxPage(page);
    await use(page);
  },
});
