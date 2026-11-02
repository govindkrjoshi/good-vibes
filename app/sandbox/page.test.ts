import { expect, test } from "vitest";
import { sandboxResponse } from "./page";

test("serves the sandbox with security headers", async () => {
  const response = sandboxResponse();
  const html = await response.text();
  const csp = response.headers.get("Content-Security-Policy");

  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(csp).toContain("sandbox allow-scripts");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'none'");
  expect(html).toContain('window.origin !== "null"');
});

test("inlines the runtime without closing its own script tag", async () => {
  const html = await sandboxResponse().text();

  expect(html.match(/<\/script>/g)).toHaveLength(3);
  expect(html.indexOf("window.Worker")).toBeLessThan(html.indexOf("AMSynth"));
});

test("grants the sandbox eval, for rack code, but no blob or worker privileges", async () => {
  const csp = sandboxResponse().headers.get("Content-Security-Policy") ?? "";

  expect(csp).toContain("'unsafe-eval'");
  expect(csp).not.toContain("blob:");
  expect(csp).not.toContain("worker-src");
});
