import { expect, type Page } from "@playwright/test";

export const DEFAULT_RESULT = "Hello from the sandbox; 40 + 2 = 42";

export const status = (page: Page) => page.getByTestId("sandbox-status");

/** Open the home page and wait for the default snippet to finish, so the sandbox is ready. */
export async function openSandboxPage(page: Page) {
  await page.goto("/");
  await expect(status(page)).toHaveText(`Sandbox result: ${DEFAULT_RESULT}`);
}

export async function runCode(page: Page, code: string) {
  await page.getByTestId("code-input").fill(code);
  await page.getByTestId("run-code").click();
}

export async function expectResult(page: Page, result: string) {
  await expect(status(page)).toHaveText(`Sandbox result: ${result}`);
}

export async function expectError(page: Page, error: string | RegExp) {
  const expected =
    typeof error === "string"
      ? `Sandbox error: ${error}`
      : new RegExp(`^Sandbox error: (?:${error.source})`, error.flags);
  await expect(status(page)).toHaveText(expected);
}
