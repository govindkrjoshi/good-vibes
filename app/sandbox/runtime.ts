import * as tone from "tone";

import { createRenderer } from "../rack/renderer";
import type { FrameMessage, HostMessage } from "./protocol";

// What runs inside the sandbox frame, inlined into its page by vite-plugin.ts.
const post = (message: FrameMessage) => window.parent.postMessage(message, "*");

if (window.origin === "null") {
  const renderer = createRenderer({
    tone,
    report: (message) => post({ type: "error", message }),
  });

  window.addEventListener(
    "message",
    ({ source, data }: MessageEvent<HostMessage>) => {
      if (source !== window.parent) return;
      if (data.type === "ping") {
        post({ type: "ready" });
      } else if (data.type === "sync") {
        renderer.reset();
        renderer.apply(data.ops);
      } else if (data.type === "diff") {
        renderer.apply(data.ops);
      }
    },
  );

  post({ type: "ready" });
}
