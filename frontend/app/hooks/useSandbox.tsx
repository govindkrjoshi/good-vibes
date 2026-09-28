import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

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

  // The iframe can finish loading before React hydrates, so its load event is
  // not a reliable signal. Log once the provider itself is mounted instead.
  useEffect(() => {
    console.log("Sandbox loaded");
  }, []);

  return (
    <SandboxContext.Provider value={{ count, setCount }}>
      {children}
      <iframe
        src={sandboxSrc}
        sandbox="allow-scripts"
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
