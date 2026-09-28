import { expect, test } from "vitest";
import { loader } from "./sandbox";

test("serves the sandbox with security headers", async () => {
  const response = loader();
  const html = await response.text();
  const csp = response.headers.get("Content-Security-Policy");

  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  expect(csp).toContain("sandbox allow-scripts");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("connect-src 'none'");
  expect(html).toContain('window.origin !== "null"');
  expect(html).toContain("event.source !== parent");
});

test("worker hides postMessage from user code and page validates worker replies", async () => {
  const html = await loader().text();

  expect(html).toContain("const send = self.postMessage.bind(self)");
  expect(html).toContain(
    "delete DedicatedWorkerGlobalScope.prototype.postMessage",
  );
  expect(html).toContain(
    'Object.defineProperty(self, \\"postMessage\\", { value: undefined',
  );
  expect(html).toContain("message.id !== frame.id");
});

test("worker keeps its privileged bindings out of the global scope", async () => {
  const html = await loader().text();
  const match = html.match(/const workerSource = ("(?:[^"\\]|\\.)*");/);
  if (!match) throw new Error("worker source not found in sandbox html");
  const workerSource = JSON.parse(match[1]) as string;

  // Function(userCode) resolves free identifiers against the worker's global
  // scope, which includes top-level let/const. Nothing may be declared there.
  const lines = workerSource
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("//"));
  const topLevel = lines.filter((line) =>
    /^(const|let|var|function|class)\b/.test(line),
  );
  expect(topLevel).toEqual([]);
  expect(lines[0]).toBe("(() => {");
  expect(lines.at(-1)).toBe("})();");
});
