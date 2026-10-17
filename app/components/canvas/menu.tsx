import { Maximize, Menu, Scan } from "lucide-react";
import { cn } from "cn";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Island } from "../ui/island";

type CanvasMenuProps = {
  readonly onFitView: () => void;
  readonly onResetZoom: () => void;
  readonly className?: string;
};

export function CanvasMenu({
  onFitView,
  onResetZoom,
  className,
}: CanvasMenuProps) {
  return (
    <Island className={cn("absolute top-4 left-4 z-10", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Canvas menu"
              data-testid="canvas-menu"
              className="rounded-lg [&_svg:not([class*='size-'])]:size-5"
            >
              <Menu />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={onFitView}>
            <Scan />
            Fit view
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onResetZoom}>
            <Maximize />
            Zoom to 100%
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Island>
  );
}
