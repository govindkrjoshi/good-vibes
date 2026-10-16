import { Effect, Exit, Scope } from "effect";
import { cn } from "cn";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { onRackWork, rackStore } from "../../rack";
import {
  hostConnect,
  hostPing,
  isFrameReady,
  makeSandboxClient,
  type AudioState,
  type SandboxClient,
} from "../../sandbox";
import { useSandboxStatus } from "../../hooks/useSandboxStatus";

type SandboxContextValue = {
  // How the frame's audio is doing, once the rack has been run.
  readonly audio: AudioState | undefined;
  // The app's end of the frame, once mounted: what waits on it goes here.
  readonly client: SandboxClient | undefined;
};

const SandboxContext = createContext<SandboxContextValue | undefined>(
  undefined,
);

// Owns the sandbox frame, where the rack's Tone.js graph lives, and the
// client that keeps it following the rack store. The store keeps the rack;
// the frame only ever gets a copy of it, and runs its leaf code.
export function SandboxProvider({
  children,
  sandboxSrc = "/sandbox.html",
}: {
  readonly children: ReactNode;
  readonly sandboxSrc?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [client, setClient] = useState<SandboxClient | undefined>(undefined);
  const audio = useSandboxStatus((status) => status.audio);

  useEffect(() => {
    // The frame each connection was made to, so a frame that loads again,
    // or one that stopped answering, is connected again.
    let boot: string | undefined;
    const ping = () => frame.current?.contentWindow?.postMessage(hostPing, "*");

    const scope = Effect.runSync(Scope.make());
    const made = Effect.runSync(
      makeSandboxClient(
        {
          getState: rackStore.getState,
          subscribe: rackStore.subscribe,
          onWork: onRackWork,
        },
        {
          onLost: () => {
            boot = undefined;
            ping();
          },
        },
      ).pipe(Scope.provide(scope)),
    );
    setClient(made);

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
      made.connect(channel.port1);
      // An opaque origin cannot be named as the target, hence "*"; the port
      // is what keeps the rest private.
      target.postMessage(hostConnect, "*", [channel.port2]);
    };
    const onVisibility = () =>
      made.setVisible(document.visibilityState === "visible");

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    // The frame can load before React hydrates, and say it is ready before
    // anyone listens, so it is asked again.
    ping();

    // The iframe's load event is not a reliable signal for the same reason,
    // so log once the provider itself is mounted.
    console.log("Sandbox loaded");

    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      setClient(undefined);
      Effect.runFork(Scope.close(scope, Exit.void));
    };
  }, []);

  // The frame stays out of sight unless the browser would not start audio
  // from the app's Run; then it shows its own button, since only a click in
  // the frame counts as a gesture there.
  const needsClick = audio === "suspended";

  return (
    <SandboxContext.Provider value={{ audio, client }}>
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
