import * as React from "react";
import { cn } from "cn";

/**
 * The floating panel chrome every canvas control sits on: a white slab that
 * hovers over the canvas rather than taking layout space beside it.
 */
const islandClassName =
  "rounded-xl bg-card p-1 text-card-foreground shadow-md ring-1 ring-foreground/5";

function Island({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="island"
      className={cn(islandClassName, className)}
      {...props}
    />
  );
}

export { Island, islandClassName };
