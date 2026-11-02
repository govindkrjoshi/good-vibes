import type { NodeProps } from "@xyflow/react";
import { Box } from "lucide-react";
import { cn } from "cn";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { JackBay } from "./jack-bay";
import type { BlockNodeType } from "../../canvas";

export function BlockNode({ data, selected }: NodeProps<BlockNodeType>) {
  return (
    <Card
      size="sm"
      data-testid="block-node"
      className={cn(
        "w-44 gap-0 overflow-visible py-0 transition-shadow",
        selected ? "ring-2 ring-ring" : "shadow-sm",
      )}
    >
      <CardHeader className="flex h-11 flex-row items-center gap-2 not-last:border-b">
        <Box aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle as="h2" className="truncate">
          {data.name}
        </CardTitle>
      </CardHeader>

      <JackBay jacks={data.jacks} />
    </Card>
  );
}
