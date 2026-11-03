import {
  Activity,
  AudioWaveform,
  Component,
  Group,
  Library,
  Lock,
  LockOpen,
  Piano,
  SlidersHorizontal,
  Speaker,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Hint } from "../ui/hint";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
} from "../ui/toolbar";

// What the catalogue menu lists: each category, its items grouped by the
// plugin they come from.
export type CatalogueSection = {
  readonly category: string;
  readonly label: string;
  readonly plugins: readonly {
    readonly name: string;
    readonly items: readonly { readonly key: string; readonly name: string }[];
  }[];
};

type RackToolbarProps = {
  readonly locked: boolean;
  readonly onToggleLock: () => void;
  readonly onAddGroup: () => void;
  readonly onAddSource: () => void;
  readonly onAddInstrument: () => void;
  readonly onAddEffect: () => void;
  readonly onAddComponent: () => void;
  readonly onAddSignal: () => void;
  readonly onAddEvent: () => void;
  readonly onAddDestination: () => void;
  readonly canDelete: boolean;
  readonly onDelete: () => void;
  readonly catalogue?: readonly CatalogueSection[];
  readonly onPick?: (itemKey: string) => void;
  readonly className?: string;
};

export function RackToolbar({
  locked,
  onToggleLock,
  onAddGroup,
  onAddSource,
  onAddInstrument,
  onAddEffect,
  onAddComponent,
  onAddSignal,
  onAddEvent,
  onAddDestination,
  canDelete,
  onDelete,
  catalogue = [],
  onPick,
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
        <Hint label="Add source">
          <ToolbarButton
            shortcut="S"
            data-testid="add-source"
            onClick={onAddSource}
          >
            <AudioWaveform />
          </ToolbarButton>
        </Hint>

        <Hint label="Add instrument">
          <ToolbarButton
            shortcut="I"
            data-testid="add-instrument"
            onClick={onAddInstrument}
          >
            <Piano />
          </ToolbarButton>
        </Hint>

        <Hint label="Add effect">
          <ToolbarButton
            shortcut="E"
            data-testid="add-effect"
            onClick={onAddEffect}
          >
            <SlidersHorizontal />
          </ToolbarButton>
        </Hint>

        <Hint label="Add component">
          <ToolbarButton
            shortcut="C"
            data-testid="add-component"
            onClick={onAddComponent}
          >
            <Component />
          </ToolbarButton>
        </Hint>

        <Hint label="Add signal">
          <ToolbarButton
            shortcut="L"
            data-testid="add-signal"
            onClick={onAddSignal}
          >
            <Activity />
          </ToolbarButton>
        </Hint>

        <Hint label="Add event">
          <ToolbarButton
            shortcut="V"
            data-testid="add-event"
            onClick={onAddEvent}
          >
            <Zap />
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

      <ToolbarGroup aria-label="Add group">
        <Hint label="Add group">
          <ToolbarButton
            shortcut="G"
            data-testid="add-group"
            onClick={onAddGroup}
          >
            <Group />
          </ToolbarButton>
        </Hint>

        {catalogue.length === 0 ? null : (
          <CatalogueMenu catalogue={catalogue} onPick={onPick} />
        )}
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
      </ToolbarGroup>
    </Toolbar>
  );
}

// Every item the catalogue holds, a category to a submenu. Picking one adds it,
// and the category's button adds it from then on.
function CatalogueMenu({
  catalogue,
  onPick,
}: {
  readonly catalogue: readonly CatalogueSection[];
  readonly onPick?: (itemKey: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ToolbarButton
            aria-label="Add from catalogue"
            data-testid="open-catalogue"
          >
            <Library />
          </ToolbarButton>
        }
      />
      <DropdownMenuContent align="center" className="w-44">
        {catalogue.map((section) => (
          <DropdownMenuSub key={section.category}>
            <DropdownMenuSubTrigger
              data-testid={`catalogue-${section.category}`}
            >
              {section.label}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-52 overflow-y-auto">
              {section.plugins.map((plugin) => (
                <DropdownMenuGroup key={plugin.name}>
                  <DropdownMenuLabel>{plugin.name}</DropdownMenuLabel>
                  {plugin.items.map((item) => (
                    <DropdownMenuItem
                      key={item.key}
                      data-testid={`catalogue-item-${item.key}`}
                      onClick={() => onPick?.(item.key)}
                    >
                      {item.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
