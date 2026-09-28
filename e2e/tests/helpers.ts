import { expect, type Page } from "@playwright/test";

export const count = (page: Page) => page.getByTestId("sandbox-count");

/** Open the home page and wait for the sandbox counter to render. */
export async function openSandboxPage(page: Page) {
  await page.goto("/");
  await expect(count(page)).toHaveText("Count: 0");
}
