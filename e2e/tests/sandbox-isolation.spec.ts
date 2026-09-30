import { expect, test } from "./fixtures";
import { type Page } from "@playwright/test";

async function sandboxFrame(page: Page) {
  const handle = await page
    .locator('iframe[title="Code sandbox"]')
    .elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("sandbox frame not found");
  return frame;
}

test("serves the sandbox document with a locked-down CSP", async ({
  request,
}) => {
  const response = await request.get("/sandbox.html");
  const csp = response.headers()["content-security-policy"] ?? "";

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(csp).toContain("sandbox allow-scripts");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(csp).not.toContain("worker-src");
});

test("embeds the sandbox as a hidden script-only iframe", async ({ page }) => {
  const iframe = page.locator('iframe[title="Code sandbox"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("src", "/sandbox.html");
  await expect(iframe).toBeHidden();
});

test("sandbox frame runs with an opaque origin and cannot reach the parent page", async ({
  page,
}) => {
  const frame = await sandboxFrame(page);

  const origin = await frame.evaluate(() => window.origin);
  expect(origin).toBe("null");

  const parentAccess = await frame.evaluate(() => {
    try {
      return `allowed:${parent.document.title}`;
    } catch (error) {
      return `blocked:${(error as Error).name}`;
    }
  });
  expect(parentAccess).toBe("blocked:SecurityError");

  const storageAccess = await frame.evaluate(() => {
    try {
      return `allowed:${typeof localStorage.getItem}`;
    } catch (error) {
      return `blocked:${(error as Error).name}`;
    }
  });
  expect(storageAccess).toBe("blocked:SecurityError");
});

test("logs to the console once the sandbox provider mounts", async ({
  context,
}) => {
  const page = await context.newPage();
  const logs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "log") logs.push(message.text());
  });

  await page.goto("/");

  await expect(() => expect(logs).toContain("Sandbox loaded")).toPass();
});

test("sandbox document refuses to run when the CSP sandbox header is missing", async ({
  context,
}) => {
  const page = await context.newPage();
  await page.route("**/sandbox.html", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });

  await page.goto("/sandbox.html");

  await expect(page.locator("body")).toHaveText(
    "Sandbox refused to run without an opaque origin.",
  );
});
