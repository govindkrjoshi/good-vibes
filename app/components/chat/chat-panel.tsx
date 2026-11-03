import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowUp,
  CircleAlert,
  MessageCircle,
  Square,
  SquarePen,
} from "lucide-react";
import { cn } from "cn";
import { explainError, type Explanation } from "../../agent";
import { Bubble, BubbleContent } from "../ui/bubble";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Hint } from "../ui/hint";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../ui/input-group";
import { Kbd } from "../ui/kbd";
import { Marker, MarkerContent, MarkerIcon } from "../ui/marker";
import { Message, MessageContent } from "../ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "../ui/message-scroller";
import { useGoodVibesAgent, type ChatMessage } from "./agent-provider";
import { rowsOf, ToolRunBlock } from "./tool-run";

const explain = (error: unknown): Explanation =>
  explainError(
    error instanceof Error ? error.message : "The message could not be sent",
  );

// Things to ask when there is nothing to show yet, each a whole request.
const openers = [
  "Build a bass line into the speakers",
  "Load the Dub Pulse demo and explain it",
  "What can you add from the catalogue?",
];

// What went wrong, and the way to a new key when that is the fix.
function Trouble({
  message,
  recover,
  onChangeKey,
  role,
}: Explanation & {
  readonly onChangeKey: () => void;
  readonly role?: "alert";
}) {
  return (
    <Marker role={role} className="items-start">
      <MarkerIcon className="mt-0.5">
        <CircleAlert />
      </MarkerIcon>
      <MarkerContent className="whitespace-pre-wrap">
        {message}
        {recover === "key" && (
          <>
            {" "}
            <button
              type="button"
              data-testid="chat-change-key"
              className="underline underline-offset-3 hover:text-foreground"
              onClick={onChangeKey}
            >
              Change the key
            </button>
          </>
        )}
      </MarkerContent>
    </Marker>
  );
}

// The agent's words sit on the panel itself; only the user's own messages get
// a bubble, so the conversation reads as the instrument talking back.
function ChatRow({
  message,
  onChangeKey,
}: {
  readonly message: ChatMessage;
  readonly onChangeKey: () => void;
}) {
  const fromUser = message.role === "user";
  return (
    <Message align={fromUser ? "end" : "start"} data-role={message.role}>
      <MessageContent>
        {message.text !== "" && (
          <Bubble
            variant={fromUser ? "secondary" : "ghost"}
            align={fromUser ? "end" : "start"}
          >
            <BubbleContent className="whitespace-pre-wrap">
              {message.text}
            </BubbleContent>
          </Bubble>
        )}
        {message.stopped === true && (
          <p data-kind="stopped" className="text-xs text-chat-dim">
            Stopped
          </p>
        )}
        {message.error !== undefined && (
          <Trouble
            message={message.error}
            recover={message.recover}
            onChangeKey={onChangeKey}
          />
        )}
      </MessageContent>
    </Message>
  );
}

export function ChatPanel({ className }: { readonly className?: string }) {
  const { messages, busy, prompt, abort, reset, changeKey } =
    useGoodVibesAgent();
  const [draft, setDraft] = useState("");
  const [trouble, setTrouble] = useState<Explanation | undefined>(undefined);
  const inputId = useId();

  const last = messages.at(-1);
  // Until the reply's first words arrive there is nothing else to show, and
  // the same once a tool is done and the agent is on to its next turn.
  const thinking =
    busy &&
    (last === undefined ||
      last.role === "user" ||
      (last.kind === "message" && last.text === "") ||
      (last.kind === "tool" && last.pending !== true));

  const ask = (text: string) => {
    if (text === "" || busy) return;
    setDraft("");
    setTrouble(undefined);
    prompt(text).catch((failure: unknown) => setTrouble(explain(failure)));
  };

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    ask(draft.trim());
  };

  // Enter sends and Shift+Enter breaks the line, except mid-composition so
  // IME users can confirm a character.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    send(event);
  };

  const empty = messages.length === 0 && !busy && trouble === undefined;
  const rows = rowsOf(messages);

  return (
    <aside
      id="chat-panel"
      aria-label="Chat"
      data-testid="chat-panel"
      className={cn(
        "flex w-80 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-sidebar-border pr-1 pl-4">
        <h2 className="text-sm font-medium">Chat</h2>
        <Hint label="New conversation">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="chat-new"
            disabled={messages.length === 0 && !busy}
            onClick={() => {
              reset();
              setTrouble(undefined);
            }}
          >
            <SquarePen />
          </Button>
        </Hint>
      </div>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="gap-5 p-4">
              {empty && (
                <Empty className="p-0">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageCircle />
                    </EmptyMedia>
                    <EmptyTitle>Talk to the agent</EmptyTitle>
                    <EmptyDescription>
                      Ask about your rack, or how to get the sound you want.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <ul className="flex flex-col gap-1.5">
                      {openers.map((opener) => (
                        <li key={opener}>
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid="chat-opener"
                            className="h-auto w-full justify-start py-1.5 text-left whitespace-normal font-normal"
                            onClick={() => ask(opener)}
                          >
                            {opener}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </EmptyContent>
                </Empty>
              )}
              {rows.map((row) =>
                row.kind === "run" ? (
                  <MessageScrollerItem key={row.run.id} messageId={row.run.id}>
                    <ToolRunBlock run={row.run} />
                  </MessageScrollerItem>
                ) : (
                  <MessageScrollerItem
                    key={row.message.id}
                    messageId={row.message.id}
                    scrollAnchor={row.message.role === "user"}
                  >
                    <ChatRow message={row.message} onChangeKey={changeKey} />
                  </MessageScrollerItem>
                ),
              )}
              {thinking && (
                <MessageScrollerItem messageId="thinking">
                  <p role="status" className="shimmer text-sm">
                    Thinking…
                  </p>
                </MessageScrollerItem>
              )}
              {trouble !== undefined && (
                <MessageScrollerItem messageId="send-error">
                  <Trouble {...trouble} role="alert" onChangeKey={changeKey} />
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton className="shadow-md ring-1 ring-foreground/5" />
        </MessageScroller>
      </MessageScrollerProvider>

      <form onSubmit={send} className="flex flex-col gap-1.5 p-3 pt-2">
        <label htmlFor={inputId} className="sr-only">
          Message the agent
        </label>
        <InputGroup className="bg-background">
          <InputGroupTextarea
            id={inputId}
            data-testid="chat-input"
            placeholder="Ask the agent…"
            rows={2}
            className="max-h-40 min-h-16 field-sizing-content"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <InputGroupAddon align="block-end" className="justify-end">
            {busy ? (
              <InputGroupButton
                size="icon-sm"
                variant="outline"
                aria-label="Stop the reply"
                data-testid="chat-stop"
                onClick={abort}
              >
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                aria-label="Send"
                data-testid="chat-send"
                disabled={draft.trim() === ""}
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        <p className="px-1 text-xs text-chat-dim">
          <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> for a new
          line
        </p>
      </form>
    </aside>
  );
}
