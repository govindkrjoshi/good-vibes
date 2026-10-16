import { createStore, type StoreApi } from "zustand";
import type { AgentDebugEvent } from "../agent";
import type { Dispatched, RackMsg } from "../rack";
import type { SandboxDebugEvent } from "../sandbox";

// A record of what the app did, for a developer to follow one change from
// the message that made it to what the sandbox did with it. Only kept when
// the page is opened with ?debug.

export type DebugEntry =
  | ({ readonly at: number; readonly source: "rack" } & Dispatched)
  | {
      readonly at: number;
      readonly source: "sandbox";
      readonly event: SandboxDebugEvent;
    }
  | {
      readonly at: number;
      readonly source: "agent";
      readonly event: AgentDebugEvent;
    };

export type DebugLog = StoreApi<{ readonly entries: readonly DebugEntry[] }>;

export const makeDebugLog = (): DebugLog =>
  createStore(() => ({ entries: [] as readonly DebugEntry[] }));

// Keeps the newest entries, so a long session does not grow without end.
export const record = (log: DebugLog, entry: DebugEntry, limit = 2000): void =>
  log.setState(({ entries }) => ({
    entries: [...entries, entry].slice(-limit),
  }));

// --- Views: pure ---------------------------------------------------------------

export type CommandView = {
  readonly cmdId: number;
  readonly batchId: number;
  readonly name: string;
  readonly target: string;
  // How the frame answered: "ok", a code, or undefined while waiting.
  readonly answer?: string;
};

export type RevisionView = {
  readonly rev: number;
  readonly messages: readonly {
    readonly envelopeId: string;
    readonly origin: string;
    readonly turnId?: string;
    readonly msg: RackMsg["_tag"];
    readonly outcome: string;
  }[];
  readonly commands: readonly CommandView[];
  // Other revisions whose commands went in the same batches: edits made
  // while a batch was in flight fold into the next one.
  readonly coalescedWith: readonly number[];
  readonly errors: readonly string[];
};

const targetOf = (target: {
  entity: string;
  id: string;
  incarnation?: string;
}) => `${target.entity} ${target.id}`;

// Every revision the rack went through, newest first, with the messages that
// made it, the commands it caused, how the frame answered them, and the
// errors that came of them. A revision with no commands had no effect in the
// sandbox, as when a block is added and removed between two batches.
export const byRevision = (entries: readonly DebugEntry[]): RevisionView[] => {
  const answers = new Map<number, string>();
  const errorsByCmd = new Map<number, string[]>();
  for (const entry of entries) {
    if (entry.source !== "sandbox") continue;
    const { event } = entry;
    if (event._tag === "Replied")
      for (const result of event.result.results)
        answers.set(result.cmdId, result.failure?.code ?? "ok");
    if (event._tag === "ErrorChanged" && event.change._tag === "Set") {
      const { cmdId, kind, id, code } = event.change.entry;
      errorsByCmd.set(cmdId, [
        ...(errorsByCmd.get(cmdId) ?? []),
        `${kind} ${id}: ${code}`,
      ]);
    }
  }

  const commandsByRev = new Map<number, CommandView[]>();
  const batchRevs = new Map<number, Set<number>>();
  for (const entry of entries) {
    if (entry.source !== "sandbox" || entry.event._tag !== "Posted") continue;
    const { batch, planned } = entry.event;
    for (const one of planned) {
      const rev = one.cause?.rev;
      if (rev === undefined) continue;
      const answer = answers.get(one.cmdId);
      const view: CommandView = {
        cmdId: one.cmdId,
        batchId: batch.batchId,
        name: one.command.name,
        target: targetOf(one.target),
        ...(answer === undefined ? {} : { answer }),
      };
      commandsByRev.set(rev, [...(commandsByRev.get(rev) ?? []), view]);
      batchRevs.set(
        batch.batchId,
        new Set([...(batchRevs.get(batch.batchId) ?? []), rev]),
      );
    }
  }

  const revisions = new Map<number, RevisionView>();
  for (const entry of entries) {
    if (entry.source !== "rack") continue;
    const view = revisions.get(entry.rev) ?? {
      rev: entry.rev,
      messages: [],
      commands: commandsByRev.get(entry.rev) ?? [],
      coalescedWith: [],
      errors: [],
    };
    revisions.set(entry.rev, {
      ...view,
      messages: [
        ...view.messages,
        ...entry.envelopes.map((envelope, index) => ({
          envelopeId: envelope.id,
          origin: envelope.origin,
          ...(envelope.turnId === undefined ? {} : { turnId: envelope.turnId }),
          msg: envelope.msg._tag,
          outcome: entry.outcomes[index]?._tag ?? "Unchanged",
        })),
      ],
    });
  }

  return [...revisions.values()]
    .map((view) => {
      const batches = new Set(view.commands.map((command) => command.batchId));
      const others = new Set<number>();
      for (const batchId of batches)
        for (const rev of batchRevs.get(batchId) ?? [])
          if (rev !== view.rev) others.add(rev);
      return {
        ...view,
        coalescedWith: [...others].sort((a, b) => a - b),
        errors: view.commands.flatMap(
          (command) => errorsByCmd.get(command.cmdId) ?? [],
        ),
      };
    })
    .sort((a, b) => b.rev - a.rev);
};

export type ChainView = {
  readonly chainId: string;
  readonly turns: readonly {
    readonly turnId: string;
    readonly kind: "prompt" | "fixup";
    readonly ok?: boolean;
  }[];
  readonly checks: readonly {
    readonly round: number;
    readonly found: string;
    readonly fingerprint?: string;
  }[];
};

// Each user prompt's chain of turns, newest first, with what each check
// after a turn found, so fix-up rounds and their fingerprints can be read.
export const byChain = (entries: readonly DebugEntry[]): ChainView[] => {
  const chains = new Map<string, ChainView>();
  const chain = (chainId: string) =>
    chains.get(chainId) ?? { chainId, turns: [], checks: [] };
  for (const entry of entries) {
    if (entry.source !== "agent") continue;
    const { event } = entry;
    switch (event._tag) {
      case "TurnStarted": {
        const held = chain(event.turn.chainId);
        chains.set(held.chainId, {
          ...held,
          turns: [
            ...held.turns,
            { turnId: event.turn.turnId, kind: event.kind },
          ],
        });
        break;
      }
      case "TurnEnded": {
        const held = chain(event.turn.chainId);
        chains.set(held.chainId, {
          ...held,
          turns: held.turns.map((turn) =>
            turn.turnId === event.turn.turnId
              ? { ...turn, ok: event.ok }
              : turn,
          ),
        });
        break;
      }
      case "Checked": {
        const held = chain(event.chainId);
        chains.set(held.chainId, {
          ...held,
          checks: [
            ...held.checks,
            {
              round: event.round,
              found:
                event.found._tag === "Errors"
                  ? `${event.found.count} errors`
                  : event.found._tag,
              ...(event.found._tag === "Errors"
                ? { fingerprint: event.found.fingerprint }
                : {}),
            },
          ],
        });
        break;
      }
      case "Cancelled":
        break;
    }
  }
  return [...chains.values()].reverse();
};
