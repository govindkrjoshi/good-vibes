import runtime from "virtual:sandbox-runtime";

export const sandboxCsp = [
  "sandbox allow-scripts",
  "frame-ancestors 'self'",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

// An inline script can't hold its own closing tag, or an HTML comment opener.
const inlineable = (script: string) =>
  script.replaceAll("</script", "<\\/script").replaceAll("<!--", "<\\!--");

export const sandboxHtml = String.raw`<!doctype html>
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
    </script>
    <script>
      // Tone builds its clock as soon as it loads, on a blob worker by default.
      // The CSP blocks that without throwing, which would leave the clock dead,
      // so workers go first and Tone falls back to its timeout clock.
      window.Worker = undefined;
    </script>
    <script>${inlineable(runtime)}</script>
  </body>
</html>`;

// The response the sandbox route serves. The frame it loads into has an
// opaque origin, and the page refuses to run with any other.
export const sandboxResponse = () =>
  new Response(sandboxHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": sandboxCsp,
    },
  });
