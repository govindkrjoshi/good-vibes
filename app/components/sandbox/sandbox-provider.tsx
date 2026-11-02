import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  attachSandbox,
  detachSandbox,
  sendToSandbox,
} from "../../sandbox/channel";
import type { FrameMessage } from "../../sandbox/protocol";
import { diffRack, emptyRackState } from "../../rack/diff";
import { useStore } from "../../stores";

type SandboxContextValue = {
  readonly count: number;
  readonly setCount: Dispatch<SetStateAction<number>>;
};

const SandboxContext = createContext<SandboxContextValue | undefined>(
  undefined,
);

export function SandboxProvider({
  children,
  sandboxSrc = "/sandbox.html",
}: {
  readonly children: ReactNode;
  readonly sandboxSrc?: string;
}) {
  const [count, setCount] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  // The iframe can finish loading before React hydrates, so its load event is
  // not a reliable signal. Log once the provider itself is mounted instead.
  useEffect(() => {
    console.log("Sandbox loaded");
  }, []);

  // Each time the frame boots it starts from nothing, so it is sent the whole
  // rack; the store's middleware sends it every change from then on.
  useEffect(() => {
    const onMessage = ({ source, data }: MessageEvent<FrameMessage>) => {
      const held = frame.current?.contentWindow;
      if (!held || source !== held) return;
      if (data.type === "ready") {
        attachSandbox(held);
        sendToSandbox({
          type: "sync",
          ops: diffRack(emptyRackState, useStore.getState().rack),
        });
      } else if (data.type === "error") {
        useStore.getState().rack.reportError(data.message);
      }
    };
    window.addEventListener("message", onMessage);
    // A frame that booted before hydration said ready to nobody.
    frame.current?.contentWindow?.postMessage({ type: "ping" }, "*");
    return () => {
      window.removeEventListener("message", onMessage);
      detachSandbox();
    };
  }, []);

  return (
    <SandboxContext.Provider value={{ count, setCount }}>
      {children}
      <iframe
        ref={frame}
        src={sandboxSrc}
        sandbox="allow-scripts"
        // Lets the frame's audio start from a click on this page.
        allow="autoplay *"
        title="Code sandbox"
        className="hidden"
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
