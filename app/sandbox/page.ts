export const sandboxCsp = [
  "sandbox allow-scripts",
  "frame-ancestors 'self'",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

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
