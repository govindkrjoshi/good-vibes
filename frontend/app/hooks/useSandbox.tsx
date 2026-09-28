import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SandboxFrame =
  | { readonly type: "ready" }
  | { readonly type: "result"; readonly id: string; readonly result: string }
  | { readonly type: "error"; readonly id: string; readonly error: string };

type SandboxContextValue = {
  readonly ready: boolean;
  readonly execute: (code: string) => void;
  readonly result: string | undefined;
  readonly error: string | undefined;
};

const SandboxContext = createContext<SandboxContextValue | undefined>(
  undefined,
);

const READY_TIMEOUT_MS = 5000;

const isSandboxFrame = (value: unknown): value is SandboxFrame => {
  if (typeof value !== "object" || value === null || !("type" in value))
    return false;
  const frame = value as Record<string, unknown>;
  return (
    frame.type === "ready" ||
    (frame.type === "result" &&
      typeof frame.id === "string" &&
      typeof frame.result === "string") ||
    (frame.type === "error" &&
      typeof frame.id === "string" &&
      typeof frame.error === "string")
  );
};

export function SandboxProvider({
  children,
  sandboxSrc = "/sandbox.html",
  readyTimeoutMs = READY_TIMEOUT_MS,
}: {
  readonly children: ReactNode;
  readonly sandboxSrc?: string;
  readonly readyTimeoutMs?: number;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pending = useRef<
    readonly { readonly id: string; readonly code: string }[]
  >([]);
  const readyRef = useRef(false);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const activeId = useRef<string | undefined>(undefined);
  const nextId = useRef(0);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();

  const post = useCallback(
    (message: { readonly id: string; readonly code: string }) => {
      if (!readyRef.current) {
        pending.current = [...pending.current, message];
        return;
      }

      iframeRef.current?.contentWindow?.postMessage(
        { type: "execute", ...message },
        "*",
      );
    },
    [],
  );

  const execute = useCallback(
    (code: string) => {
      setResult(undefined);
      setError(undefined);
      const id = `sandbox-${++nextId.current}`;
      activeId.current = id;
      post({ id, code });
    },
    [post],
  );

  const ping = useCallback(() => {
    if (!readyRef.current)
      iframeRef.current?.contentWindow?.postMessage({ type: "ping" }, "*");
  }, []);

  // A sandbox that loads but never reports ready (blocked script, stricter CSP,
  // 404 page) would otherwise leave every execute queued forever.
  const armReadyTimeout = useCallback(() => {
    clearTimeout(readyTimer.current);
    readyTimer.current = setTimeout(() => {
      if (readyRef.current) return;
      pending.current = [];
      setResult(undefined);
      setError("Sandbox failed to load");
    }, readyTimeoutMs);
  }, [readyTimeoutMs]);

  const handleLoad = useCallback(() => {
    readyRef.current = false;
    setReady(false);
    ping();
    armReadyTimeout();
  }, [ping, armReadyTimeout]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (
        event.source !== iframeRef.current?.contentWindow ||
        !isSandboxFrame(event.data)
      )
        return;

      switch (event.data.type) {
        case "ready": {
          clearTimeout(readyTimer.current);
          readyRef.current = true;
          setReady(true);
          const queued = pending.current;
          pending.current = [];
          for (const message of queued) {
            iframeRef.current?.contentWindow?.postMessage(
              { type: "execute", ...message },
              "*",
            );
          }
          return;
        }
        case "result":
          if (event.data.id !== activeId.current) return;
          setResult(event.data.result);
          setError(undefined);
          return;
        case "error":
          if (event.data.id !== activeId.current) return;
          setError(event.data.error);
          setResult(undefined);
          return;
      }
    };

    window.addEventListener("message", onMessage);
    // On a server-rendered page the iframe can finish loading before React
    // hydrates, so the load handler above may never run. Ping and arm the
    // timeout here as well so a broken sandbox is still reported.
    ping();
    armReadyTimeout();

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(readyTimer.current);
    };
  }, [ping, armReadyTimeout]);

  return (
    <SandboxContext.Provider value={{ ready, execute, result, error }}>
      {children}
      <iframe
        ref={iframeRef}
        src={sandboxSrc}
        sandbox="allow-scripts"
        title="Code sandbox"
        className="hidden"
        onLoad={handleLoad}
        onError={handleLoad}
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
