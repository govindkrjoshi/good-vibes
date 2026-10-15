import { expect, test } from "vitest";
import { sandboxHtml, sandboxResponse } from "./page";

const csp = () =>
  sandboxResponse().headers.get("Content-Security-Policy") ?? "";

test("serves the sandbox with security headers", async () => {
  const response = sandboxResponse();
  const html = await response.text();

  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(csp()).toContain("sandbox allow-scripts");
  expect(csp()).not.toContain("allow-same-origin");
  expect(csp()).toContain("frame-ancestors 'self'");
  expect(csp()).toContain("default-src 'none'");
  expect(csp()).toContain("connect-src blob:");
  expect(html).toContain('window.origin !== "null"');
});

// Leaf code arrives as source and is evaluated in the frame, which needs
// eval; Tone.js runs its clock worker and worklets from blobs. Nothing is
// let in from the network.
test("grants the sandbox eval and its own blobs, but nothing remote", () => {
  expect(csp()).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:;");
  expect(csp()).toContain("worker-src blob:");
  expect(csp()).toContain("connect-src blob:");
  expect(csp()).not.toMatch(/https?:|\*|data:/);
});

test("inlines the frame's bundled script after the origin check", async () => {
  const html = await sandboxResponse().text();

  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html.indexOf('window.origin !== "null"')).toBeLessThan(
    html.indexOf("good-vibes:sandbox"),
  );
  expect(html).toContain('id="start-audio"');
});

test("cannot be closed early by the script it inlines", () => {
  const html = sandboxHtml('const end = "<\\/script>";');

  expect(html.match(/<\/script>/g)).toHaveLength(2);
});
