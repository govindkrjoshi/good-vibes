import { cn } from "cn";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { noopRuntime, rackStore } from "../../rack";
import {
  hostConnect,
  hostPing,
  isFrameReady,
  makeSandboxClient,
  type AudioState,
} from "../../sandbox";

type SandboxContextValue = {
  // How the frame's audio is doing, once the rack has been run.
  readonly audio: AudioState | undefined;
};

const SandboxContext = createContext<SandboxContextValue | undefined>(
  undefined,
);

// Owns the sandbox frame, where the rack's Tone.js graph lives, and plugs the
// app's end of it into the rack store as its runtime. The store keeps the rack;
// the frame only ever gets a copy of it, and runs its leaf code.
export function SandboxProvider({
  children,
  sandboxSrc = "/sandbox.html",
}: {
  readonly children: ReactNode;
  readonly sandboxSrc?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [audio, setAudio] = useState<AudioState | undefined>(undefined);

  useEffect(() => {
    const client = makeSandboxClient(rackStore.getState);
    rackStore.setState({ runtime: client.runtime });
    const unsubscribe = client.onAudio(setAudio);
    let boot: string | undefined;

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
    window.addEventListener("message", onMessage);
    // The frame can load before React hydrates, and say it is ready before
    // anyone listens, so it is asked again.
    frame.current?.contentWindow?.postMessage(hostPing, "*");

    // The iframe's load event is not a reliable signal for the same reason,
    // so log once the provider itself is mounted.
    console.log("Sandbox loaded");

    return () => {
      window.removeEventListener("message", onMessage);
      unsubscribe();
      client.close();
      rackStore.setState({ runtime: noopRuntime });
    };
  }, []);

  // The frame stays out of sight unless the browser would not start audio
  // from the app's Run; then it shows its own button, since only a click in
  // the frame counts as a gesture there.
  const needsClick = audio === "suspended";

  return (
    <SandboxContext.Provider value={{ audio }}>
      {children}
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
    </SandboxContext.Provider>
  );
}

export const useSandbox = (): SandboxContextValue => {
  const sandbox = useContext(SandboxContext);
  if (sandbox === undefined)
    throw new Error("useSandbox must be used inside SandboxProvider");
  return sandbox;
};
