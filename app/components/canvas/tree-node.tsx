import type { NodeProps } from "@xyflow/react";
import { Group, Plus } from "lucide-react";
import { cn } from "cn";
import { Card, CardHeader, CardTitle } from "../ui/card";
import { JackBay } from "./jack-bay";
import { useCanvasStore } from "./canvas-store";
import { useStore } from "../../stores";
import type { Jack } from "../../rack";
import type { TreeNodeType } from "../../canvas";

function AddJack({
  direction,
  rackId,
  rackName,
}: {
  readonly direction: Jack["direction"];
  readonly rackId: string;
  readonly rackName: string;
}) {
  const addJack = useStore((state) => state.rack.addJack);
  const label = direction === "in" ? "Input" : "Output";

  return (
    <button
      type="button"
      aria-label={`Add ${label.toLowerCase()} to ${rackName}`}
      onClick={() => addJack(rackId, direction)}
      className="nodrag flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Plus aria-hidden className="size-3" />
      {label}
    </button>
  );
}

// The bay is see-through, so a tree reads as a space to put racks in rather
// than one more rack.
export function TreeNode({ id, data, selected }: NodeProps<TreeNodeType>) {
  const isDropTarget = useCanvasStore((state) => state.dropTargetId === id);
  const locked = useCanvasStore((state) => state.locked);
  const removeJack = useStore((state) => state.rack.removeJack);

  return (
    <Card
      size="sm"
      data-testid="tree-node"
      data-drop-target={isDropTarget || undefined}
      className={cn(
        "size-full gap-0 overflow-visible py-0 transition-colors motion-reduce:transition-none",
        isDropTarget ? "bg-muted/70" : "bg-card/40",
        (selected || isDropTarget) && "ring-2 ring-ring",
      )}
    >
      <CardHeader className="flex h-11 flex-row items-center gap-2 not-last:border-b">
        <Group aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle as="h2" className="truncate">
          {data.name}
        </CardTitle>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {data.childCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {data.childCount === 1 ? "1 rack" : `${data.childCount} racks`}
            </span>
          )}
          {!locked && (
            <>
              <AddJack direction="in" rackId={id} rackName={data.name} />
              <AddJack direction="out" rackId={id} rackName={data.name} />
            </>
          )}
        </div>
      </CardHeader>

      <JackBay
        inside
        jacks={data.jacks}
        rackName={data.name}
        onRemove={locked ? undefined : removeJack}
      />

      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {isDropTarget
          ? `Drop to add to ${data.name}`
          : data.childCount === 0
            ? "Drag a rack here"
            : null}
      </div>
    </Card>
  );
}
