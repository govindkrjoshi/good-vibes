import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { buttonVariants } from "~/components/ui/button";
import { islandClassName } from "~/components/ui/island";

function Toolbar({ className, ...props }: ToolbarPrimitive.Root.Props) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      className={cn(
        islandClassName,
        "flex items-center gap-1 data-vertical:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function ToolbarGroup({ className, ...props }: ToolbarPrimitive.Group.Props) {
  return (
    <ToolbarPrimitive.Group
      data-slot="toolbar-group"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

// The toolbar owns arrow-key navigation, so its buttons only borrow the button
// component's look, not its behaviour. `shortcut` renders the key hint tucked
// into the corner of the icon, the way canvas tools usually label themselves.
function ToolbarButton({
  className,
  variant = "ghost",
  size = "icon-lg",
  active = false,
  shortcut,
  children,
  ...props
}: ToolbarPrimitive.Button.Props &
  VariantProps<typeof buttonVariants> & {
    active?: boolean;
    shortcut?: string;
  }) {
  return (
    <ToolbarPrimitive.Button
      data-slot="toolbar-button"
      data-active={active || undefined}
      className={cn(
        buttonVariants({ variant, size }),
        "relative rounded-lg data-active:bg-accent data-active:text-accent-foreground [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    >
      {children}
      {shortcut !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 bottom-0.5 text-[9px] leading-none font-normal text-muted-foreground"
        >
          {shortcut}
        </span>
      )}
    </ToolbarPrimitive.Button>
  );
}

function ToolbarSeparator({
  className,
  ...props
}: ToolbarPrimitive.Separator.Props) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn(
        "shrink-0 bg-border data-horizontal:h-px data-horizontal:w-full data-vertical:mx-0.5 data-vertical:h-6 data-vertical:w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator };
