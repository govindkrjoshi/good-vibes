import { expect, test } from "@playwright/test";
import {
  expectError,
  expectResult,
  openSandboxPage,
  runCode,
  status,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openSandboxPage(page);
});

test("returns the result of user code", async ({ page }) => {
  await runCode(page, "return 1 + 1;");
  await expectResult(page, "2");
});

test("surfaces errors thrown by user code", async ({ page }) => {
  await runCode(page, 'throw new Error("boom");');
  await expectError(page, "boom");
});

test("attributes results to each run in order", async ({ page }) => {
  await runCode(page, 'return "first";');
  await expectResult(page, "first");

  await runCode(page, 'return "second";');
  await expectResult(page, "second");
});

test("terminates runaway code and keeps working afterwards", async ({
  page,
}) => {
  await runCode(page, "while (true) {}");
  await expectError(page, "Sandbox execution timed out");

  await runCode(page, 'return "alive";');
  await expectResult(page, "alive");
});

test("user code has no access to the DOM or web storage", async ({ page }) => {
  await runCode(
    page,
    "return [typeof document, typeof window, typeof localStorage].join(',');",
  );
  await expectResult(page, "undefined,undefined,undefined");
});

test("user code cannot make network requests", async ({ page }) => {
  let requests = 0;
  await page.route("https://example.com/**", (route) => {
    requests += 1;
    return route.abort();
  });

  await runCode(
    page,
    `const xhr = new XMLHttpRequest();
     xhr.open("GET", "https://example.com/", false);
     xhr.send();
     return xhr.status;`,
  );
  await expectError(page, /.+/);

  await runCode(
    page,
    'importScripts("https://example.com/script.js"); return "loaded";',
  );
  await expectError(page, /.+/);

  expect(requests).toBe(0);
});

test("user code cannot forge a sandbox reply", async ({ page }) => {
  const forged = '{ type: "result", id: "sandbox-2", result: "forged" }';

  await runCode(page, `self.postMessage(${forged}); return "done";`);
  await expectError(page, /.*postMessage.*/);

  await runCode(page, `postMessage(${forged}); return "done";`);
  await expectError(page, /.*postMessage.*/);

  // The worker keeps its real channel in a closure named `send`. Function(...)
  // resolves free identifiers against the global scope, so it must not be there.
  await runCode(page, `send(${forged}); return "done";`);
  await expectError(page, "send is not defined");

  // Full exploit shape: forge a reply for a predictable id, then hang so the
  // real reply never arrives. The forged reply must never be accepted.
  await runCode(page, `try { send(${forged}); } catch {} while (true) {}`);
  await expectError(page, "Sandbox execution timed out");
  await expect(status(page)).not.toContainText("forged");
});
