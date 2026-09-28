const csp = [
  "sandbox allow-scripts",
  "frame-ancestors 'self'",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

const workerSource = String.raw`
// Everything privileged lives inside this closure. Functions created with
// Function(...) close over the global scope, which in a classic worker script
// includes top-level let/const bindings, so nothing here may be top-level.
(() => {
  // Capture the real channel to the page, then remove it from the global scope so
  // user code cannot forge a result or error message.
  const send = self.postMessage.bind(self);
  delete DedicatedWorkerGlobalScope.prototype.postMessage;
  Object.defineProperty(self, "postMessage", { value: undefined, writable: false, configurable: false });

  self.addEventListener("message", (event) => {
    const frame = event.data;
    if (!frame || frame.type !== "execute" || typeof frame.id !== "string" || typeof frame.code !== "string") return;

    try {
      const result = Function(frame.code)();
      send({ type: "result", id: frame.id, result: String(result) });
    } catch (error) {
      send({
        type: "error",
        id: frame.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
})();
`;

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Code sandbox</title>
  </head>
  <body>
    <script>
      if (window.origin !== "null") {
        document.body.textContent = "Sandbox refused to run without an opaque origin.";
        throw new Error("Sandbox must run with an opaque origin");
      }

      const WORKER_TIMEOUT_MS = 1000;
      const post = (frame) => parent.postMessage(frame, "*");
      const workerSource = ${JSON.stringify(workerSource)};

      const run = (frame) => {
        const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        const worker = new Worker(workerUrl);
        let settled = false;

        const finish = (message) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          post(message);
        };

        const timeout = setTimeout(() => {
          finish({ type: "error", id: frame.id, error: "Sandbox execution timed out" });
        }, WORKER_TIMEOUT_MS);

        worker.addEventListener("message", (event) => {
          const message = event.data;
          if (!message || typeof message !== "object" || message.id !== frame.id) return;
          if (message.type === "result" && typeof message.result === "string") return finish(message);
          if (message.type === "error" && typeof message.error === "string") return finish(message);
        });
        worker.addEventListener("error", (event) => {
          finish({ type: "error", id: frame.id, error: event.message || "Sandbox worker failed" });
        });
        worker.postMessage(frame);
      };

      window.addEventListener("message", (event) => {
        if (event.source !== parent) return;

        const frame = event.data;
        if (!frame || typeof frame !== "object") return;

        if (frame.type === "ping") {
          post({ type: "ready" });
          return;
        }

        if (
          frame.type !== "execute" ||
          typeof frame.id !== "string" ||
          typeof frame.code !== "string"
        ) {
          return;
        }

        run(frame);
      });

      post({ type: "ready" });
    </script>
  </body>
</html>`;

export function loader() {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
    },
  });
}
