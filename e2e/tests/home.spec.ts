import { expect, test } from "@playwright/test";
import { DEFAULT_RESULT, openSandboxPage, status } from "./helpers";

test("runs the default snippet through the sandbox on load", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Sandbox demo" }),
  ).toBeVisible();
  await expect(page.getByTestId("code-input")).toContainText(
    "Hello from the sandbox",
  );
  await expect(status(page)).toHaveText(`Sandbox result: ${DEFAULT_RESULT}`);
  await expect(page.getByTestId("run-code")).toBeEnabled();
});

test("embeds the sandbox as a hidden script-only iframe", async ({ page }) => {
  await openSandboxPage(page);

  const iframe = page.locator('iframe[title="Code sandbox"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("src", "/sandbox.html");
  await expect(iframe).toBeHidden();
});

test("reports a load failure when the sandbox never becomes ready", async ({
  page,
}) => {
  await page.route("**/sandbox.html", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>broken</title>",
    }),
  );

  await page.goto("/");

  await expect(status(page)).toHaveText("Loading sandbox…");
  await expect(page.getByTestId("run-code")).toBeDisabled();
  await expect(status(page)).toHaveText(
    "Sandbox error: Sandbox failed to load",
    { timeout: 10_000 },
  );
  await expect(page.getByTestId("run-code")).toBeDisabled();
});
