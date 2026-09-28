import { useEffect, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from "@xyflow/react";
import { useSandbox } from "../hooks/useSandbox";

export function meta() {
  return [{ title: "Good Vibes" }];
}

const defaultCode = `const greeting = "Hello from the sandbox";
const answer = 40 + 2;
return greeting + "; 40 + 2 = " + answer;`;

export default function Home() {
  const { ready, execute, result, error } = useSandbox();
  const [code, setCode] = useState(defaultCode);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    execute(defaultCode);
  }, [execute]);

  const status =
    error !== undefined
      ? `Sandbox error: ${error}`
      : result !== undefined
        ? `Sandbox result: ${result}`
        : ready
          ? "Running in sandbox…"
          : "Loading sandbox…";

  return (
    <main className="relative h-screen w-screen">
      <ReactFlow fitView>
        <Background variant={BackgroundVariant.Lines} />
        <Controls />
      </ReactFlow>

      <section className="absolute left-4 top-4 w-full max-w-md rounded-lg border border-neutral-200 bg-white/90 p-4 text-sm shadow-lg backdrop-blur">
        <h1 className="mb-2 font-semibold">Sandbox demo</h1>
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            execute(code);
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-neutral-600">
              JavaScript to run in the sandbox
            </span>
            <textarea
              data-testid="code-input"
              className="min-h-32 rounded border border-neutral-300 bg-white p-2 font-mono text-xs"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            type="submit"
            data-testid="run-code"
            disabled={!ready}
            className="self-start rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
          >
            Run
          </button>
        </form>
        <p data-testid="sandbox-status" className="mt-2 break-words">
          {status}
        </p>
      </section>
    </main>
  );
}
