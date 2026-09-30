import { cloneElement, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type HintProps = {
  readonly label: string;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly children: ReactElement<{ "aria-label"?: string }>;
};

/**
 * Labels an icon-only control once: the text names the button for screen
 * readers and shows as its tooltip for everyone else.
 */
export function Hint({ label, side = "bottom", children }: HintProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={cloneElement(children, { "aria-label": label })}
      />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
