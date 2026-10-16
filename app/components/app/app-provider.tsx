import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentService, CreateAgent } from "../../agent";
import { makeDebugLog, type DebugLog } from "../../debug/log";
import { makeAppRuntime, type AppRuntime } from "../../runtime";
import { DebugPanel } from "../debug/debug-panel";
import type { SandboxClient } from "../../sandbox";
import { SandboxFrame } from "../sandbox/sandbox-frame";

const AppContext = createContext<AppRuntime | undefined>(undefined);

// Runs the app's runtime (app/runtime.ts) for as long as it is mounted, and
// the sandbox frame the runtime's client talks to. Everything that runs on
// its own, the sandbox client and the agent service, lives in the runtime;
// this only decides when it starts and stops.
export function AppProvider({
  children,
  sandboxSrc,
  createAgent,
}: {
  readonly children: ReactNode;
  readonly sandboxSrc?: string;
  // For tests: how the agent itself is made.
  readonly createAgent?: CreateAgent;
}) {
  const [app, setApp] = useState<AppRuntime | undefined>(undefined);
  const [debug, setDebug] = useState<DebugLog | undefined>(undefined);
  // What to do when the frame stops answering; the frame sets it.
  const onLost = useRef<() => void>(() => {});

  useEffect(() => {
    // Read here, not while rendering: the server has no URL to read.
    const log = new URLSearchParams(window.location.search).has("debug")
      ? makeDebugLog()
      : undefined;
    const made = makeAppRuntime({
      onSandboxLost: () => onLost.current(),
      ...(createAgent === undefined ? {} : { createAgent }),
      ...(log === undefined ? {} : { debug: log }),
    });
    setApp(made);
    setDebug(log);
    return () => {
      setApp(undefined);
      setDebug(undefined);
      void made.dispose();
    };
  }, [createAgent]);

  return (
    <AppContext.Provider value={app}>
      {children}
      <SandboxFrame
        client={app?.sandbox}
        onLost={onLost}
        {...(sandboxSrc === undefined ? {} : { sandboxSrc })}
      />
      {debug === undefined ? null : <DebugPanel log={debug} />}
    </AppContext.Provider>
  );
}

// The sandbox client and the agent service, once the runtime is up.
export const useSandboxClient = (): SandboxClient | undefined =>
  useContext(AppContext)?.sandbox;

export const useAgentService = (): AgentService | undefined =>
  useContext(AppContext)?.agent;
