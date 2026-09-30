import { CircleQuestionMark } from "lucide-react";
import { cn } from "cn";
import { Button } from "./ui/button";
import { Island } from "./ui/island";
import { Kbd } from "./ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";

const shortcuts = [
  { keys: "G", action: "Add group" },
  { keys: "S", action: "Add source" },
  { keys: "I", action: "Add instrument" },
  { keys: "E", action: "Add effect" },
  { keys: "C", action: "Add component" },
  { keys: "L", action: "Add signal" },
  { keys: "V", action: "Add event" },
  { keys: "⌫", action: "Delete selection" },
  { keys: "R", action: "Run rack" },
] as const;

export function HelpButton({ className }: { readonly className?: string }) {
  return (
    <Island className={cn("absolute right-4 bottom-4 z-10", className)}>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Keyboard shortcuts"
              data-testid="help"
              className="rounded-lg [&_svg:not([class*='size-'])]:size-5"
            >
              <CircleQuestionMark />
            </Button>
          }
        />
        <PopoverContent align="end" side="top" className="w-56">
          <PopoverHeader>
            <PopoverTitle>Keyboard shortcuts</PopoverTitle>
          </PopoverHeader>
          <dl className="grid gap-2">
            {shortcuts.map(({ keys, action }) => (
              <div key={keys} className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">{action}</dt>
                <dd>
                  <Kbd>{keys}</Kbd>
                </dd>
              </div>
            ))}
          </dl>
        </PopoverContent>
      </Popover>
    </Island>
  );
}
