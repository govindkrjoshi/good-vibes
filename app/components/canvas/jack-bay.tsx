import { useEffect } from "react";
import {
  Handle,
  Position,
  useNodeId,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { X } from "lucide-react";
import { cn } from "cn";
import { treeJackRowHeight } from "../../canvas";
import type { Jack } from "../../rack";

type RemoveProps = {
  readonly rackName?: string;
  readonly onRemove?: ((jackId: string) => void) | undefined;
};

const rowStyle = { height: treeJackRowHeight };

// A socket on the rack's edge. An input is an open ring waiting for a cable and
// an output is solid, so direction reads without the label. The socket is small,
// so an invisible margin around it takes the pointer.
const socket = { in: "bg-card!", out: "bg-foreground!" };

function JackRow({
  jack,
  rackName,
  onRemove,
}: RemoveProps & { readonly jack: Jack }) {
  const isInput = jack.direction === "in";

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
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        className={cn(
          "size-1.5! min-h-0! min-w-0! border! border-foreground! transition-shadow after:absolute after:-inset-2 after:content-[''] hover:ring-2 hover:ring-ring motion-reduce:transition-none [&.valid]:ring-2 [&.valid]:ring-ring",
          isInput ? socket.in : socket.out,
        )}
      />
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
  rackName,
  onRemove,
}: RemoveProps & { readonly jacks: readonly Jack[] }) {
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
                {...(rackName === undefined ? {} : { rackName })}
                onRemove={onRemove}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
