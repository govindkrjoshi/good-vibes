import { expect, test } from "@playwright/test";
import { count, openSandboxPage } from "./helpers";

test("updates the sandbox counter through the hook", async ({ page }) => {
  await openSandboxPage(page);

  await expect(
    page.getByRole("heading", { name: "Sandbox demo" }),
  ).toBeVisible();

  await page.getByTestId("increment").click();
  await expect(count(page)).toHaveText("Count: 1");

  await page.getByTestId("increment").click();
  await expect(count(page)).toHaveText("Count: 2");

  await page.getByTestId("reset").click();
  await expect(count(page)).toHaveText("Count: 0");
});

test("embeds the sandbox as a hidden script-only iframe", async ({ page }) => {
  await openSandboxPage(page);

  const iframe = page.locator('iframe[title="Code sandbox"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("src", "/sandbox.html");
  await expect(iframe).toBeHidden();
});

test("logs to the console once the sandbox provider mounts", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "log") logs.push(message.text());
  });

  await openSandboxPage(page);

  await expect(() => expect(logs).toContain("Sandbox loaded")).toPass();
});
