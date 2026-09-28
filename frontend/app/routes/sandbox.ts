const csp = [
  "sandbox allow-scripts",
  "frame-ancestors 'self'",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

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
