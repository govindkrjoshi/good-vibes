import { Minus, Plus, Redo2, Undo2 } from "lucide-react";
import { cn } from "cn";
import { Hint } from "~/components/hint";
import { Button } from "~/components/ui/button";
import { Island } from "~/components/ui/island";

type ViewportControlsProps = {
  readonly zoom: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  readonly onResetZoom: () => void;
  /** History is not implemented yet, so undo and redo stay disabled. */
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly className?: string;
};

const iconButton = "rounded-lg [&_svg:not([class*='size-'])]:size-4";

/** Zoom and history islands, bottom-left. */
export function ViewportControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onUndo,
  onRedo,
  className,
}: ViewportControlsProps) {
  return (
    <div
      className={cn(
        "absolute bottom-4 left-4 z-10 flex items-center gap-2",
        className,
      )}
    >
      <Island className="flex items-center gap-1">
        <Hint label="Zoom out" side="top">
          <Button
            variant="ghost"
            size="icon-lg"
            data-testid="zoom-out"
            className={iconButton}
            onClick={onZoomOut}
          >
            <Minus />
          </Button>
        </Hint>

        <Hint label="Reset zoom to 100%" side="top">
          <Button
            variant="ghost"
            size="lg"
            data-testid="zoom-level"
            className="min-w-14 rounded-lg text-xs tabular-nums"
            onClick={onResetZoom}
          >
            {Math.round(zoom * 100)}%
          </Button>
        </Hint>

        <Hint label="Zoom in" side="top">
          <Button
            variant="ghost"
            size="icon-lg"
            data-testid="zoom-in"
            className={iconButton}
            onClick={onZoomIn}
          >
            <Plus />
          </Button>
        </Hint>
      </Island>

      <Island className="flex items-center gap-1">
        <Hint label="Undo" side="top">
          <Button
            variant="ghost"
            size="icon-lg"
            data-testid="undo"
            className={iconButton}
            disabled={onUndo === undefined}
            onClick={onUndo}
          >
            <Undo2 />
          </Button>
        </Hint>

        <Hint label="Redo" side="top">
          <Button
            variant="ghost"
            size="icon-lg"
            data-testid="redo"
            className={iconButton}
            disabled={onRedo === undefined}
            onClick={onRedo}
          >
            <Redo2 />
          </Button>
        </Hint>
      </Island>
    </div>
  );
}
