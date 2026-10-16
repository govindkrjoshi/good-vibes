import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AgentService, CreateAgent } from "../../agent";
import { makeAppRuntime, type AppRuntime } from "../../runtime";
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
  // What to do when the frame stops answering; the frame sets it.
  const onLost = useRef<() => void>(() => {});

  useEffect(() => {
    const made = makeAppRuntime({
      onSandboxLost: () => onLost.current(),
      ...(createAgent === undefined ? {} : { createAgent }),
    });
    setApp(made);
    return () => {
      setApp(undefined);
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
    </AppContext.Provider>
  );
}

// The sandbox client and the agent service, once the runtime is up.
export const useSandboxClient = (): SandboxClient | undefined =>
  useContext(AppContext)?.sandbox;

export const useAgentService = (): AgentService | undefined =>
  useContext(AppContext)?.agent;
