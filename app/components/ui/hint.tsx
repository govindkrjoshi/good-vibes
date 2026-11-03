import { cloneElement, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type HintProps = {
  readonly label: string;
  // A second, quieter line, such as what a tool will add.
  readonly detail?: string;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly children: ReactElement<{ "aria-label"?: string }>;
};

export function Hint({ label, detail, side = "bottom", children }: HintProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={cloneElement(children, { "aria-label": label })}
      />
      <TooltipContent side={side}>
        {detail === undefined ? (
          label
        ) : (
          <span className="flex flex-col">
            <span>{label}</span>
            <span className="text-background/70">{detail}</span>
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
