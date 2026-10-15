import frameScript from "virtual:sandbox-frame";

// The frame runs leaf code the app did not write, so it may run scripts but
// gets little else: an opaque origin (no allow-same-origin), no network, and
// nothing to load from anywhere but itself. Its own script is inlined.
// 'unsafe-eval' is there because leaf code arrives as source and is evaluated
// here, which is the point of the frame; that code can reach no more than the
// frame can. blob: is there because Tone.js makes some of what it runs from
// blobs: its clock's worker, the AudioWorklet modules behind nodes like
// BitCrusher (loaded as scripts), and buffers or media it reads back from blob
// URLs. A blob can only be made by the frame itself, so none of this reaches
// the network.
export const sandboxCsp = [
  "sandbox allow-scripts",
  "frame-ancestors 'self'",
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "worker-src blob:",
  "connect-src blob:",
  "media-src blob:",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

// Shown, along with the frame, when the browser would not start audio from
// the app's Run: a click inside the frame is a gesture the frame can use.
const startAudioButton = String.raw`<button id="start-audio" type="button" hidden>
      Click to start audio
    </button>`;

const styles = String.raw`<style>
      html, body { margin: 0; height: 100%; background: transparent; }
      body {
        display: grid;
        place-items: center;
        font: 500 14px/1.2 system-ui, sans-serif;
      }
      #start-audio {
        padding: 10px 16px;
        border: 0;
        border-radius: 999px;
        background: #111;
        color: #fff;
        font: inherit;
        cursor: pointer;
      }
      #start-audio[hidden] { display: none; }
    </style>`;

export const sandboxHtml = (
  script: string = frameScript,
) => String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Code sandbox</title>
    ${styles}
  </head>
  <body>
    ${startAudioButton}
    <script>
      if (window.origin !== "null") {
        document.body.textContent = "Sandbox refused to run without an opaque origin.";
        throw new Error("Sandbox must run with an opaque origin");
      }
    </script>
    <script>${script}</script>
  </body>
</html>`;

// The response the sandbox route serves. The frame it loads into has an
// opaque origin, and the page refuses to run with any other.
export const sandboxResponse = () =>
  new Response(sandboxHtml(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": sandboxCsp,
    },
  });
