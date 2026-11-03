import { useEffect } from "react";
import {
  Handle,
  Position,
  useNodeId,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "cn";
import { useCanvasStore } from "./lock-store";
import { insideHandleId, treeJackRowHeight } from "../../canvas";
import type { Jack } from "../../rack";

type RemoveProps = {
  readonly rackName?: string;
  readonly onRemove?: (jackId: string) => void;
};

const rowStyle = { height: treeJackRowHeight };

// At the inner end of the row, clear of the label. Cables leave it downward,
// towards the racks in the tree.
const insideStyle = {
  in: {
    top: "50%",
    bottom: "auto",
    left: "auto",
    right: 12,
    transform: "translateY(-50%)",
  },
  out: {
    top: "50%",
    bottom: "auto",
    left: 12,
    right: "auto",
    transform: "translateY(-50%)",
  },
};

// A socket on the rack's edge. An input is an open ring waiting for a cable and
// an output is solid, so direction reads without the label. The socket is small,
// so an invisible margin around it takes the pointer.
const socket =
  "size-1.5! min-h-0! min-w-0! border! border-foreground! transition-shadow after:absolute after:-inset-2 after:content-[''] hover:ring-2 hover:ring-ring motion-reduce:transition-none [&.valid]:ring-2 [&.valid]:ring-ring";
const ring = "bg-card!";
const solid = "bg-foreground!";

function JackRow({
  jack,
  inside,
  rackName,
  onRemove,
}: RemoveProps & { readonly jack: Jack; readonly inside: boolean }) {
  const isInput = jack.direction === "in";
  // A handle stays connectable on a locked canvas unless it is told otherwise.
  const locked = useCanvasStore((state) => state.locked);

  return (
    <div
      data-testid="jack"
      style={rowStyle}
      className={cn(
        "group/jack relative flex items-center gap-1 px-3 text-xs text-muted-foreground",
        !isInput && "flex-row-reverse",
      )}
    >
      <Handle
        id={jack.id}
        isConnectable={!locked}
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        className={cn(socket, isInput ? ring : solid)}
      />
      {inside && (
        // Seen from inside the tree the jack flips: an input emits to the racks
        // in the tree, and an output takes what they emit.
        <Handle
          id={insideHandleId(jack.id)}
          isConnectable={!locked}
          type={isInput ? "source" : "target"}
          position={Position.Bottom}
          style={isInput ? insideStyle.in : insideStyle.out}
          className={cn(socket, isInput ? solid : ring)}
        />
      )}
      <span className="truncate">{jack.name}</span>
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Remove ${jack.name} from ${rackName}`}
          onClick={() => onRemove(jack.id)}
          className="nodrag rounded-sm opacity-0 group-hover/jack:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
    </div>
  );
}

// Every rack's jacks, in the band under its title: inputs against the left edge
// and outputs against the right.
export function JackBay({
  jacks,
  inside = false,
  rackName,
  onRemove,
}: RemoveProps & {
  readonly jacks: readonly Jack[];
  readonly inside?: boolean;
}) {
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();

  // React Flow only measures handles when told to, and these can come and go.
  const jackKey = jacks.map((jack) => jack.id).join();
  useEffect(() => {
    if (nodeId !== null) updateNodeInternals(nodeId);
  }, [nodeId, jackKey, updateNodeInternals]);

  if (jacks.length === 0) return null;

  return (
    <div className="grid shrink-0 grid-cols-2 border-b last:border-b-0">
      {(["in", "out"] as const).map((direction) => (
        <div
          key={direction}
          data-testid={`jacks-${direction}`}
          className="flex min-w-0 flex-col"
        >
          {jacks
            .filter((jack) => jack.direction === direction)
            .map((jack) => (
              <JackRow
                key={jack.id}
                jack={jack}
                inside={inside}
                rackName={rackName}
                onRemove={onRemove}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
