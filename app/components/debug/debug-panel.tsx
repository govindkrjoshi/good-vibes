import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { cn } from "cn";
import { Button } from "../ui/button";
import { byChain, byRevision, type DebugLog } from "../../debug/log";

// What the app did, by revision and by chain, for a developer. Only shown
// when the page is opened with ?debug.
export function DebugPanel({ log }: { readonly log: DebugLog }) {
  const entries = useStore(log, (state) => state.entries);
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<"revisions" | "chains">("revisions");
  const revisions = useMemo(() => byRevision(entries).slice(0, 50), [entries]);
  const chains = useMemo(() => byChain(entries).slice(0, 20), [entries]);

  return (
    <section
      aria-label="Debug log"
      data-testid="debug-panel"
      className={cn(
        "fixed right-2 bottom-2 z-50 flex w-96 max-w-[calc(100vw-1rem)] flex-col rounded-lg border bg-background font-mono text-xs shadow-lg",
        open && "h-80",
      )}
    >
      <header className="flex items-center gap-1 border-b p-1">
        <Button
          size="xs"
          variant={view === "revisions" ? "secondary" : "ghost"}
          onClick={() => setView("revisions")}
        >
          Revisions
        </Button>
        <Button
          size="xs"
          variant={view === "chains" ? "secondary" : "ghost"}
          onClick={() => setView("chains")}
        >
          Chains
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => setOpen((held) => !held)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </header>
      {!open ? null : (
        <ol className="flex-1 overflow-auto p-2">
          {view === "revisions"
            ? revisions.map((revision) => (
                <li
                  key={revision.rev}
                  data-testid="debug-revision"
                  className="border-b py-1"
                >
                  <p className="font-semibold">rev {revision.rev}</p>
                  {revision.messages.map((message) => (
                    <p key={message.envelopeId}>
                      {message.origin} {message.msg} → {message.outcome}
                      {message.turnId === undefined
                        ? ""
                        : ` (${message.turnId})`}
                    </p>
                  ))}
                  {revision.commands.length === 0 ? (
                    <p className="text-muted-foreground">no sandbox effect</p>
                  ) : (
                    revision.commands.map((command) => (
                      <p key={command.cmdId} className="pl-2">
                        #{command.cmdId} {command.name} {command.target}:{" "}
                        {command.answer ?? "…"}
                      </p>
                    ))
                  )}
                  {revision.coalescedWith.length === 0 ? null : (
                    <p className="pl-2 text-muted-foreground">
                      sent with rev {revision.coalescedWith.join(", ")}
                    </p>
                  )}
                  {revision.errors.map((error) => (
                    <p key={error} className="pl-2 text-destructive">
                      {error}
                    </p>
                  ))}
                </li>
              ))
            : chains.map((chain) => (
                <li
                  key={chain.chainId}
                  data-testid="debug-chain"
                  className="border-b py-1"
                >
                  <p className="font-semibold">{chain.chainId}</p>
                  {chain.turns.map((turn) => (
                    <p key={turn.turnId}>
                      {turn.kind} {turn.turnId}:{" "}
                      {turn.ok === undefined ? "…" : turn.ok ? "ok" : "failed"}
                    </p>
                  ))}
                  {chain.checks.map((check) => (
                    <p key={check.round} className="pl-2">
                      check {check.round}: {check.found}
                      {check.fingerprint === undefined
                        ? ""
                        : ` [${check.fingerprint}]`}
                    </p>
                  ))}
                </li>
              ))}
        </ol>
      )}
    </section>
  );
}
