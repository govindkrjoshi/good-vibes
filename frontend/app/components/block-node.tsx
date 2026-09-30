import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Box, Group } from "lucide-react";
import { cn } from "cn";
import { Card, CardHeader, CardTitle } from "./ui/card";
import type { Jack } from "../types/rack";

export type BlockNodeData = {
  readonly name: string;
  readonly kind: "node" | "tree";
  /** The block's jacks, resolved from their ids: one handle each. */
  readonly jacks: readonly Jack[];
};

export type BlockNodeType = Node<BlockNodeData, "block">;

/**
 * One rack block on the canvas. A block wires up through its jacks, so a block
 * without any has no handles yet and simply cannot be patched.
 */
export function BlockNode({ data, selected }: NodeProps<BlockNodeType>) {
  const Icon = data.kind === "tree" ? Group : Box;

  return (
    <Card
      size="sm"
      data-testid="block-node"
      className={cn(
        "w-44 gap-0 transition-shadow",
        selected ? "ring-2 ring-ring" : "shadow-sm",
      )}
    >
      {data.jacks.map((jack) => (
        <Handle
          key={jack.id}
          id={jack.id}
          type={jack.direction === "in" ? "target" : "source"}
          position={jack.direction === "in" ? Position.Left : Position.Right}
        />
      ))}

      <CardHeader className="flex flex-row items-center gap-2">
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle as="h2" className="truncate">
          {data.name}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
