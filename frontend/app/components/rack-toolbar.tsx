import { Box, Group, Lock, LockOpen } from "lucide-react";
import { cn } from "cn";
import { Hint } from "~/components/hint";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "~/components/ui/toolbar";

type RackToolbarProps = {
  readonly locked: boolean;
  readonly onToggleLock: () => void;
  readonly onAddNode: () => void;
  readonly onAddGroup: () => void;
  readonly className?: string;
};

/** The tool island: centred at the top edge, floating over the canvas. */
export function RackToolbar({
  locked,
  onToggleLock,
  onAddNode,
  onAddGroup,
  className,
}: RackToolbarProps) {
  return (
    <Toolbar
      aria-label="Rack tools"
      className={cn("absolute top-4 left-1/2 z-10 -translate-x-1/2", className)}
    >
      <Hint label={locked ? "Unlock canvas" : "Lock canvas"}>
        <ToolbarButton
          active={locked}
          data-testid="toggle-lock"
          onClick={onToggleLock}
        >
          {locked ? <Lock /> : <LockOpen />}
        </ToolbarButton>
      </Hint>

      <ToolbarSeparator />

      <ToolbarGroup aria-label="Add blocks">
        <Hint label="Add node">
          <ToolbarButton
            shortcut="N"
            data-testid="add-node"
            onClick={onAddNode}
          >
            <Box />
          </ToolbarButton>
        </Hint>

        <Hint label="Add group">
          <ToolbarButton
            shortcut="G"
            data-testid="add-group"
            onClick={onAddGroup}
          >
            <Group />
          </ToolbarButton>
        </Hint>
      </ToolbarGroup>
    </Toolbar>
  );
}
