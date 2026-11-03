import { useRef, useState, type RefObject } from "react";
import {
  BrushCleaning,
  Group,
  Lock,
  LockOpen,
  Speaker,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "../ui/button";
import { Hint } from "../ui/hint";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "../ui/toolbar";
import { useCatalogueSearch, type CatalogueSection } from "./catalogue-search";

export type { CatalogueSection } from "./catalogue-search";

type RackToolbarProps = {
  readonly locked: boolean;
  readonly onToggleLock: () => void;
  readonly onAddGroup: () => void;
  readonly onAddDestination: () => void;
  readonly canDelete: boolean;
  readonly onDelete: () => void;
  readonly canClear?: boolean;
  readonly onClear?: () => void;
  readonly catalogue?: readonly CatalogueSection[];
  readonly onPick?: (itemKey: string) => void;
  // Set to what focuses the search field, for a shortcut to call.
  readonly focusSearch?: RefObject<(() => void) | null>;
  readonly className?: string;
};

// The canvas's tools: the lock, a search over the whole catalogue, the two
// racks that aren't modules, and the ways to take racks away.
export function RackToolbar({
  locked,
  onToggleLock,
  onAddGroup,
  onAddDestination,
  canDelete,
  onDelete,
  canClear = false,
  onClear = () => {},
  catalogue = [],
  onPick = () => {},
  focusSearch,
  className,
}: RackToolbarProps) {
  const within = useRef<HTMLDivElement>(null);
  const search = useCatalogueSearch({ catalogue, onPick, within });
  if (focusSearch !== undefined) focusSearch.current = search.focus;

  return (
    <div
      ref={within}
      className={cn(
        "absolute top-4 left-1/2 z-10 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col",
        className,
      )}
    >
      <Toolbar aria-label="Rack tools" className="min-w-0">
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

        {search.field}

        <ToolbarSeparator />

        <ToolbarGroup aria-label="Add">
          <Hint label="Add group">
            <ToolbarButton
              shortcut="G"
              data-testid="add-group"
              onClick={onAddGroup}
            >
              <Group />
            </ToolbarButton>
          </Hint>

          <Hint label="Add destination">
            <ToolbarButton
              shortcut="D"
              data-testid="add-destination"
              onClick={onAddDestination}
            >
              <Speaker />
            </ToolbarButton>
          </Hint>
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup aria-label="Edit">
          <Hint label="Delete selection">
            <ToolbarButton
              shortcut="⌫"
              disabled={!canDelete}
              data-testid="delete-selection"
              onClick={onDelete}
            >
              <Trash2 />
            </ToolbarButton>
          </Hint>

          <ClearButton disabled={!canClear} onClear={onClear} />
        </ToolbarGroup>
      </Toolbar>

      {search.list}
    </div>
  );
}

// Clearing can't be undone, so it asks first.
function ClearButton({
  disabled,
  onClear,
}: {
  readonly disabled: boolean;
  readonly onClear: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="Clear canvas">
        <PopoverTrigger
          disabled={disabled}
          render={
            <ToolbarButton data-testid="clear-canvas" disabled={disabled}>
              <BrushCleaning />
            </ToolbarButton>
          }
        />
      </Hint>
      <PopoverContent align="end" sideOffset={10} className="w-64">
        <PopoverHeader>
          <PopoverTitle>Clear the canvas?</PopoverTitle>
          <PopoverDescription>
            Removes every rack and patch. This can’t be undone; the tempo stays.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="confirm-clear"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            Clear canvas
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
