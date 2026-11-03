import { CircleQuestionMark } from "lucide-react";
import { Button } from "../ui/button";
import { Island } from "../ui/island";
import { Kbd } from "../ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";

const shortcuts = [
  { keys: "/", action: "Find a module" },
  { keys: "G", action: "Add group" },
  { keys: "D", action: "Add destination" },
  { keys: "⌫", action: "Delete selection" },
] as const;

export function HelpButton() {
  return (
    <Island className="absolute right-4 bottom-4 z-10">
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
