import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from "@xyflow/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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

      <Card className="absolute left-4 top-4 w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle as="h1">Sandbox demo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p data-testid="sandbox-count">Count: {count}</p>
          <div className="flex gap-2">
            <Button
              data-testid="increment"
              onClick={() => setCount((current) => current + 1)}
            >
              Increment
            </Button>
            <Button
              variant="outline"
              data-testid="reset"
              onClick={() => setCount(0)}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
