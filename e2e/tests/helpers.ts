import { expect, type Page } from "@playwright/test";

export const count = (page: Page) => page.getByTestId("sandbox-count");

/** Open the home page and wait for React to hydrate. */
export async function openSandboxPage(page: Page) {
  // The counter is server-rendered, so its text shows up before hydration and
  // cannot gate interaction: a click landing first is silently dropped. The
  // provider's mount log is the signal that handlers are attached.
  const hydrated = page.waitForEvent(
    "console",
    (message) =>
      message.type() === "log" && message.text() === "Sandbox loaded",
  );
  await page.goto("/");
  await hydrated;
  await expect(count(page)).toHaveText("Count: 0");
}
