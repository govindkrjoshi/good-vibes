import { useState, type ReactNode } from "react";
import { useReactFlow } from "@xyflow/react";
import { Check, ChevronRight, CircleAlert } from "lucide-react";
import { cn } from "cn";
import { useStore } from "../../stores";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible";
import { Marker, MarkerContent, MarkerIcon } from "../ui/marker";
import { Spinner } from "../ui/spinner";
import type { ChatMessage } from "./agent-provider";

// One turn's work on the rack: what the agent said it would do, and the
// tools it called to do it, on one rail.
export type ToolRun = {
  readonly id: string;
  readonly brief?: ChatMessage;
  readonly tools: readonly ChatMessage[];
};

// An id the agent wrote in brackets. A rack's id finds it on the canvas;
// any other (a patch, an event) is only named.
function IdChip({ id }: { readonly id: string }) {
  const onCanvas = useStore((state) => state.rack.racks[id] !== undefined);
  const { fitView } = useReactFlow();
  const className =
    "inline-flex max-w-full items-baseline rounded-sm bg-muted px-1 font-medium text-foreground";
  if (!onCanvas) return <span className={className}>{id}</span>;
  return (
    <button
      type="button"
      data-testid="rack-chip"
      title={`Show ${id} on the canvas`}
      className={cn(
        className,
        "cursor-pointer outline-none hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_8%)] focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
      onClick={(event) => {
        event.stopPropagation();
        void fitView({ nodes: [{ id }], duration: 300, maxZoom: 1 });
      }}
    >
      {id}
    </button>
  );
}

const bracketed = /\[([^\]\s]+)\]/g;
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// The agent's words with every [id] as a chip. A patch, event or
// automation gets a generated id the model needs and the user does not, so
// one of those is left off the line; it is still in the tool's full result.
export function IdText({ text }: { readonly text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(bracketed)) {
    const id = match[1];
    if (id === undefined) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (uuid.test(id)) {
      // Take the space after it too, so the words either side read on.
      const next = text[match.index + match[0].length];
      last = match.index + match[0].length + (next === " " ? 1 : 0);
      continue;
    }
    parts.push(<IdChip key={`${match.index}-${id}`} id={id} />);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const show = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);

// One tool call: a line on what it did, turning while it runs, that opens
// to what it was asked and everything it reported. What went wrong is
// always in view.
function ToolRow({ message }: { readonly message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const args = Object.entries(message.args ?? {});
  const details = args.length > 0 || (message.result ?? "") !== "";
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-kind="tool"
      data-role="assistant"
      className="flex flex-col"
    >
      <CollapsibleTrigger
        disabled={!details}
        className="group flex w-full items-start gap-2 rounded-sm py-0.5 text-left text-xs text-chat-dim outline-none enabled:hover:text-foreground enabled:focus-visible:ring-2 enabled:focus-visible:ring-ring/50"
      >
        {message.pending === true ? (
          <Spinner className="mt-0.5 size-3 shrink-0" />
        ) : message.error !== undefined ? (
          <CircleAlert aria-hidden className="mt-0.5 size-3 shrink-0" />
        ) : (
          <Check aria-hidden className="mt-0.5 size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 wrap-break-word">
          <IdText text={message.text} />
        </span>
        {details && (
          <ChevronRight
            aria-hidden
            className="mt-0.5 size-3 shrink-0 opacity-0 transition-[opacity,rotate] group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-expanded:rotate-90 group-aria-expanded:opacity-100"
          />
        )}
      </CollapsibleTrigger>
      {message.error !== undefined && (
        <Marker className="pl-5 text-xs text-destructive">
          <MarkerIcon className="hidden" />
          <MarkerContent className="whitespace-pre-wrap">
            {message.error}
          </MarkerContent>
        </Marker>
      )}
      <CollapsibleContent className="flex flex-col gap-1.5 pt-1 pb-1 pl-5 text-xs">
        {args.length > 0 && (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5">
            {args.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-chat-dim">{key}</dt>
                <dd className="wrap-break-word whitespace-pre-wrap text-foreground">
                  {show(value)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {(message.result ?? "") !== "" && message.error === undefined && (
          <pre className="max-h-60 overflow-auto rounded-md bg-background p-2 font-sans whitespace-pre-wrap text-foreground ring-1 ring-foreground/5">
            {message.result}
          </pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolRunBlock({ run }: { readonly run: ToolRun }) {
  return (
    <section
      data-kind="run"
      aria-label={run.brief?.text ?? "Changes to the rack"}
      className="flex flex-col gap-1 border-l-2 border-chat-rail pl-3"
    >
      {run.brief !== undefined && (
        <p
          data-kind="brief"
          data-role="assistant"
          className="text-sm leading-relaxed text-foreground"
        >
          <IdText text={run.brief.text} />
        </p>
      )}
      {run.tools.map((tool) => (
        <ToolRow key={tool.id} message={tool} />
      ))}
    </section>
  );
}

// Groups the conversation for showing: each brief opens a run that the
// tools after it join, tools with no brief make a run of their own, and
// anything said is a row by itself.
export type ChatRow =
  | { readonly kind: "message"; readonly message: ChatMessage }
  | { readonly kind: "run"; readonly run: ToolRun };

export const rowsOf = (messages: readonly ChatMessage[]): ChatRow[] => {
  const rows: ChatRow[] = [];
  let open:
    { id: string; brief?: ChatMessage; tools: ChatMessage[] } | undefined;
  for (const message of messages) {
    if (message.kind === "brief") {
      open = { id: message.id, brief: message, tools: [] };
      rows.push({ kind: "run", run: open });
    } else if (message.kind === "tool") {
      if (open === undefined) {
        open = { id: message.id, tools: [] };
        rows.push({ kind: "run", run: open });
      }
      open.tools.push(message);
    } else {
      open = undefined;
      rows.push({ kind: "message", message });
    }
  }
  return rows;
};
