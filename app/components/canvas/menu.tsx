import { Maximize, Menu, Scan } from "lucide-react";
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
};

export function CanvasMenu({ onFitView, onResetZoom }: CanvasMenuProps) {
  return (
    <Island className="absolute top-4 left-4 z-10">
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
