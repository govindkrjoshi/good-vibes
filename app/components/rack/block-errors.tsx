import { useMemo } from "react";
import { CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { useRack } from "../../hooks/useRack";
import { useSandboxStatus } from "../../hooks/useSandboxStatus";
import { rackEnvelope } from "../../rack";
import type { ErrorEntry } from "../../sandbox";

// What each kind of failure means to someone playing the rack.
const lead: Record<ErrorEntry["kind"], string> = {
  build: "Didn't build",
  param: "Setting not applied",
  schedule: "Event not scheduled",
  play: "Couldn't play",
  playback: "Failed while playing",
  connect: "Not connected",
};

// What a Retry rebuilds, for the failures that can be tried again as they
// are. A param or a play is tried again by changing or playing it.
const retryable = (
  entry: ErrorEntry,
): { readonly entity: "block" | "event"; readonly id: string } | undefined =>
  entry.kind === "build"
    ? { entity: "block", id: entry.id }
    : entry.kind === "schedule" || entry.kind === "playback"
      ? { entity: "event", id: entry.id }
      : undefined;

// The sandbox's failures for a block: its own build, and those of its params
// and events, each with what to do about it.
export function BlockErrors({ blockId }: { readonly blockId: string }) {
  const errors = useSandboxStatus((status) => status.errors);
  const params = useRack((state) => state.params);
  const events = useRack((state) => state.events);
  const dispatch = useRack((state) => state.dispatch);

  const mine = useMemo(
    () =>
      Object.values(errors).filter((entry) => {
        switch (entry.kind) {
          case "build":
            return entry.id === blockId;
          case "param":
            return params[entry.id]?.belongToBlockId === blockId;
          case "schedule":
          case "play":
          case "playback":
            return events[entry.id]?.belongToBlockId === blockId;
          case "connect":
            return false;
        }
      }),
    [errors, params, events, blockId],
  );
  if (mine.length === 0) return null;

  // One line per failure, so a node grows little; the whole message is in
  // its title. Only the button stops a drag, so the node still moves when
  // grabbed by its error.
  return (
    <ul className="flex flex-col border-b bg-destructive/5 px-3 py-1">
      {mine.map((entry) => {
        const retry = retryable(entry);
        const text = `${lead[entry.kind]}: ${entry.message}`;
        return (
          <li
            key={`${entry.kind}:${entry.id}`}
            data-testid="block-error"
            data-code={entry.code}
            title={text}
            className="flex h-6 items-center gap-1.5 text-xs"
          >
            <CircleAlert
              aria-hidden
              className="size-3.5 shrink-0 text-destructive"
            />
            <p className="min-w-0 flex-1 truncate">
              <span className="font-medium text-destructive">
                {lead[entry.kind]}:
              </span>{" "}
              {entry.message}
            </p>
            {retry === undefined ? null : (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Retry"
                data-testid="retry-block"
                className="nodrag shrink-0"
                onClick={() =>
                  dispatch(
                    rackEnvelope({
                      _tag: "Retry",
                      entity: retry.entity,
                      entityId: retry.id,
                    }),
                  )
                }
              >
                <RotateCcw />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
