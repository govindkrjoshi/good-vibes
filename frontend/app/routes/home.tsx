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

export default function Home() {
  const { count, setCount } = useSandbox();

  return (
    <main className="relative h-screen w-screen">
      <ReactFlow fitView>
        <Background variant={BackgroundVariant.Lines} />
        <Controls />
      </ReactFlow>

      <section className="absolute left-4 top-4 w-full max-w-md rounded-lg border border-neutral-200 bg-white/90 p-4 text-sm shadow-lg backdrop-blur">
        <h1 className="mb-2 font-semibold">Sandbox demo</h1>
        <p data-testid="sandbox-count" className="mb-2">
          Count: {count}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="increment"
            onClick={() => setCount((current) => current + 1)}
            className="rounded bg-neutral-900 px-3 py-1 text-white"
          >
            Increment
          </button>
          <button
            type="button"
            data-testid="reset"
            onClick={() => setCount(0)}
            className="rounded border border-neutral-300 px-3 py-1"
          >
            Reset
          </button>
        </div>
      </section>
    </main>
  );
}
