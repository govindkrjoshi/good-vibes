import { expect, test as base, type Page } from "@playwright/test";
import { toolbar } from "./helpers";

export { expect };

/** Opens the home page and waits for React to hydrate. */
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

/**
 * `page` arrives already on the hydrated sandbox, so every test starts from the
 * same state. A test that needs to control the first request itself — stubbing
 * a response header, or watching the console from before navigation — should
 * take `context` and open its own page instead.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await openSandboxPage(page);
    await use(page);
  },
});
