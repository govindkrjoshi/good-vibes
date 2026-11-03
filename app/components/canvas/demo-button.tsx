import { useState } from "react";
import { Sparkles } from "lucide-react";
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
import { ToolbarButton } from "../ui/toolbar";

// A demo as the toolbar offers it.
export type DemoChoice = {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly racks: number;
};

type DemoButtonProps = {
  readonly demos: readonly DemoChoice[];
  // Whether loading would take racks away, in which case it asks first.
  readonly replaces: boolean;
  readonly disabled?: boolean;
  readonly onLoad: (demoId: string) => void;
};

// Lists the demos; a pick that would replace what is on the canvas asks
// first, in the same popover.
export function DemoButton({
  demos,
  replaces,
  disabled = false,
  onLoad,
}: DemoButtonProps) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<DemoChoice>();

  const close = () => {
    setOpen(false);
    setConfirming(undefined);
  };
  const load = (demo: DemoChoice) => {
    onLoad(demo.id);
    close();
  };
  const pick = (demo: DemoChoice) => {
    if (replaces) setConfirming(demo);
    else load(demo);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirming(undefined);
      }}
    >
      <Hint label="Load a demo">
        <PopoverTrigger
          disabled={disabled}
          render={
            <ToolbarButton data-testid="load-demo" disabled={disabled}>
              <Sparkles />
            </ToolbarButton>
          }
        />
      </Hint>
      <PopoverContent align="end" sideOffset={10} className="w-80">
        {confirming === undefined ? (
          <>
            <PopoverHeader>
              <PopoverTitle>Load a demo</PopoverTitle>
              <PopoverDescription>
                Racks built to show what the graph can do, from one chain to a
                session that plays itself. Press play once it is in.
              </PopoverDescription>
            </PopoverHeader>
            <ul className="-mx-1 flex flex-col gap-0.5">
              {demos.map((demo) => (
                <li key={demo.id}>
                  <button
                    type="button"
                    data-testid={`demo-${demo.id}`}
                    onClick={() => pick(demo)}
                    className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">{demo.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {demo.racks} racks
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {demo.tagline}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <PopoverHeader>
              <PopoverTitle>
                Replace the canvas with {confirming.name}?
              </PopoverTitle>
              <PopoverDescription>
                Every rack and patch on the canvas goes. This can’t be undone.
              </PopoverDescription>
            </PopoverHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(undefined)}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                size="sm"
                data-testid="confirm-load-demo"
                onClick={() => load(confirming)}
              >
                Load demo
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
