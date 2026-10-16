import {
  CircleAlert,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Settings,
  Square,
  UserRound,
} from "lucide-react";
import { cn } from "cn";
import { Hint } from "../ui/hint";
import { NumberField } from "../rack/param-control";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { useGoodVibesAgent } from "../chat/agent-provider";
import { useRack } from "../../hooks/useRack";
import { useDispatch } from "../../hooks/useDispatch";
import { edits } from "../../rack";
import { useSandboxStatus } from "../../hooks/useSandboxStatus";

// The app's fixed chrome: the chat toggle and name on the left, the transport
// in the middle where it stays put whatever the canvas is doing, and settings
// and the profile on the right.
export function TopBar({
  chatOpen,
  onToggleChat,
  className,
}: {
  readonly chatOpen: boolean;
  readonly onToggleChat: () => void;
  readonly className?: string;
}) {
  const dispatch = useDispatch();
  const run = () => dispatch(edits.run());
  const stop = () => dispatch(edits.stop());
  const bpm = useRack((state) => state.transport.bpm);

  const { changeKey } = useGoodVibesAgent();

  return (
    <header
      className={cn(
        "grid h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4 border-b border-sidebar-border bg-sidebar px-2 text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Hint label={chatOpen ? "Hide chat" : "Show chat"}>
          <Button
            variant="ghost"
            size="icon"
            data-testid="toggle-chat"
            aria-expanded={chatOpen}
            aria-controls="chat-panel"
            onClick={onToggleChat}
          >
            {chatOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </Hint>
        <img src="/favicon.svg" alt="" className="size-6 max-sm:hidden" />
        <span className="truncate text-sm font-semibold max-sm:sr-only">
          Good Vibes
        </span>
      </div>

      <div
        role="group"
        aria-label="Transport"
        className="flex items-center gap-2"
      >
        <div className="flex items-center gap-2">
          <Label htmlFor="transport-bpm" className="max-sm:sr-only">
            BPM
          </Label>
          <div className="w-14">
            <NumberField
              id="transport-bpm"
              value={bpm}
              min={1}
              step={1}
              onCommit={(next) => dispatch(edits.setTransport(next))}
            />
          </div>
        </div>
        <Separator
          orientation="vertical"
          className="mx-1 h-5 self-center max-sm:hidden"
        />
        <Button data-testid="run-rack" onClick={run}>
          <Play data-icon="inline-start" />
          <span className="max-sm:sr-only">Run</span>
        </Button>
        <Button variant="outline" data-testid="stop-rack" onClick={stop}>
          <Square data-icon="inline-start" />
          <span className="max-sm:sr-only">Stop</span>
        </Button>
      </div>

      <div className="flex items-center justify-end gap-1">
        <SandboxNotice />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Settings"
                data-testid="settings"
              >
                <Settings />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Settings</DropdownMenuLabel>
              <DropdownMenuItem onClick={changeKey}>
                <KeyRound />
                Change OpenRouter key
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Profile"
                data-testid="profile"
                className="rounded-full"
              >
                <Avatar size="sm">
                  <AvatarFallback>
                    <UserRound className="size-3.5" />
                  </AvatarFallback>
                </Avatar>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Not signed in</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled>Sign in</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// Says so when the audio engine in the sandbox frame stops answering, or the
// rack cannot be sent to it. Edits are kept either way, and sent once it can
// take them.
function SandboxNotice() {
  const notice = useSandboxStatus((status) =>
    status.syncBlocked !== undefined
      ? "Can't send the rack to the audio engine"
      : status.connection._tag === "Lost"
        ? "Audio engine stopped responding. Reconnecting…"
        : undefined,
  );
  if (notice === undefined) return null;

  return (
    <p
      role="status"
      data-testid="sandbox-notice"
      className="flex min-w-0 items-center gap-1.5 px-2 text-xs text-destructive"
    >
      <CircleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate max-md:sr-only">{notice}</span>
    </p>
  );
}
