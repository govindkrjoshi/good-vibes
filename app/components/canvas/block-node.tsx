import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Group } from "lucide-react";
import { cn } from "cn";
import { Card, CardHeader, CardTitle } from "../ui/card";
import type { BlockNodeType } from "../../canvas";

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
