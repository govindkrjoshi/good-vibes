import { cloneElement, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type HintProps = {
  readonly label: string;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly children: ReactElement<{ "aria-label"?: string }>;
};

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
