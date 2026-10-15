import { expect, test } from "./fixtures";
import { sandboxFrame } from "./helpers";

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
  expect(csp).toContain("connect-src blob:");
  expect(csp).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:;");
  expect(csp).toContain("worker-src blob:");
  expect(csp).not.toMatch(/https?:/);
  expect(csp).not.toContain("allow-same-origin");
});

test("embeds the sandbox as a hidden script-only iframe", async ({ page }) => {
  const iframe = page.locator('iframe[title="Code sandbox"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("src", "/sandbox.html");
  await expect(iframe).toHaveAttribute("allow", "autoplay");
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

// Tone.js makes its clock's worker and its AudioWorklet modules from blobs,
// so the frame has to be able to run both, but still reach no network.
test("sandbox frame can run blob workers and worklets, but not fetch", async ({
  page,
}) => {
  const frame = await sandboxFrame(page);

  const result = await frame.evaluate(async () => {
    const blobUrl = (source: string) =>
      URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = await new Promise<string>((resolve) => {
      const running = new Worker(blobUrl("postMessage('tick')"));
      running.onmessage = (event) => resolve(String(event.data));
      running.onerror = () => resolve("blocked");
    });
    const worklet = await new OfflineAudioContext(1, 128, 44100).audioWorklet
      .addModule(
        blobUrl(
          "registerProcessor('noop', class extends AudioWorkletProcessor { process() { return false; } });",
        ),
      )
      .then(
        () => "loaded",
        () => "blocked",
      );
    const network = await fetch("https://example.com").then(
      () => "allowed",
      () => "blocked",
    );
    return { worker, worklet, network };
  });

  expect(result).toEqual({
    worker: "tick",
    worklet: "loaded",
    network: "blocked",
  });
});

test("Tone's clock ticks from a worker in the frame", async ({ page }) => {
  await page.addInitScript(() => {
    const counted = window as unknown as { workers: number };
    counted.workers = 0;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        counted.workers += 1;
      }
    };
  });
  await page.reload();
  const frame = await sandboxFrame(page);

  await expect
    .poll(() =>
      frame.evaluate(() => (window as unknown as { workers: number }).workers),
    )
    .toBeGreaterThan(0);
});
