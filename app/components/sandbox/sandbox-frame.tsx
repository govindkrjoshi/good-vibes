import { cn } from "cn";
import { useEffect, useRef, type RefObject } from "react";
import { useSandboxStatus } from "../../hooks/useSandboxStatus";
import {
  hostConnect,
  hostPing,
  isFrameReady,
  type SandboxClient,
} from "../../sandbox";

// The sandboxed frame the rack's Tone.js graph lives in, connected to the
// app's sandbox client. The frame only ever gets a copy of the rack, and runs
// its leaf code.
export function SandboxFrame({
  client,
  onLost,
  sandboxSrc = "/sandbox.html",
}: {
  readonly client: SandboxClient | undefined;
  // Set here to what reconnects the frame when it stops answering.
  readonly onLost: RefObject<() => void>;
  readonly sandboxSrc?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const audio = useSandboxStatus((status) => status.audio);

  useEffect(() => {
    if (client === undefined) return;
    // The frame each connection was made to, so a frame that loads again,
    // or one that stopped answering, is connected again.
    let boot: string | undefined;
    const ping = () => frame.current?.contentWindow?.postMessage(hostPing, "*");
    onLost.current = () => {
      boot = undefined;
      ping();
    };

    // Only the frame's own window is listened to; its origin is opaque, so
    // that is the only way to know a message is from it.
    const onMessage = (event: MessageEvent<unknown>) => {
      const target = frame.current?.contentWindow;
      if (
        target === null ||
        target === undefined ||
        event.source !== target ||
        !isFrameReady(event.data) ||
        event.data.boot === boot
      ) {
        return;
      }
      boot = event.data.boot;
      const channel = new MessageChannel();
      client.connect(channel.port1);
      // An opaque origin cannot be named as the target, hence "*"; the port
      // is what keeps the rest private.
      target.postMessage(hostConnect, "*", [channel.port2]);
    };
    const onVisibility = () =>
      client.setVisible(document.visibilityState === "visible");

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    // The frame can load before React hydrates, and say it is ready before
    // anyone listens, so it is asked again.
    ping();

    // The iframe's load event is not a reliable signal for the same reason,
    // so log once the frame is wired up.
    console.log("Sandbox loaded");

    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      onLost.current = () => {};
    };
  }, [client, onLost]);

  // The frame stays out of sight unless the browser would not start audio
  // from the app's Run; then it shows its own button, since only a click in
  // the frame counts as a gesture there.
  const needsClick = audio === "suspended";

  return (
    <iframe
      ref={frame}
      src={sandboxSrc}
      sandbox="allow-scripts"
      allow="autoplay"
      title="Code sandbox"
      className={cn(
        needsClick
          ? "fixed bottom-20 left-1/2 z-50 h-14 w-64 -translate-x-1/2 border-0 bg-transparent"
          : "hidden",
      )}
    />
  );
}
