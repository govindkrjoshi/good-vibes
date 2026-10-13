import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  CircleAlert,
  MessageCircle,
  Square,
} from "lucide-react";
import { cn } from "cn";
import { Bubble, BubbleContent } from "../ui/bubble";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../ui/input-group";
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
import { Spinner } from "../ui/spinner";
import { useGoodVibesAgent, type ChatMessage } from "./agent-provider";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "The message could not be sent";

// A change the agent asked for: what it is doing while it waits, then what
// came of it.
function ActionRow({ message }: { readonly message: ChatMessage }) {
  const status = message.status ?? "done";
  return (
    <Message
      align="start"
      data-role={message.role}
      data-testid="chat-action"
      data-status={status}
    >
      <MessageContent>
        <Marker>
          <MarkerIcon>
            {status === "requested" ? (
              <Spinner />
            ) : status === "done" ? (
              <Check />
            ) : (
              <CircleAlert />
            )}
          </MarkerIcon>
          <MarkerContent>{message.text}</MarkerContent>
        </Marker>
        {message.error !== undefined && (
          <Marker className="pl-6">
            <MarkerContent>{message.error}</MarkerContent>
          </Marker>
        )}
      </MessageContent>
    </Message>
  );
}

// The agent's words sit on the panel itself; only the user's own messages get
// a bubble, so the conversation reads as the instrument talking back.
function ChatRow({ message }: { readonly message: ChatMessage }) {
  if (message.kind === "action") return <ActionRow message={message} />;
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
        {message.error !== undefined && (
          <Marker>
            <MarkerIcon>
              <CircleAlert />
            </MarkerIcon>
            <MarkerContent>{message.error}</MarkerContent>
          </Marker>
        )}
      </MessageContent>
    </Message>
  );
}

export function ChatPanel({ className }: { readonly className?: string }) {
  const { messages, busy, prompt, abort } = useGoodVibesAgent();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const inputId = useId();

  const last = messages.at(-1);
  // Until the reply's first words arrive there is nothing else to show. A
  // settled action is one of those gaps: the agent is working out what to say
  // or do next.
  const thinking =
    busy &&
    (last === undefined ||
      last.role === "user" ||
      last.text === "" ||
      (last.kind === "action" && last.status !== "requested"));

  const send = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text === "" || busy) return;
    setDraft("");
    setError(undefined);
    prompt(text).catch((failure: unknown) => setError(errorText(failure)));
  };

  // Enter sends and Shift+Enter breaks the line, except mid-composition so
  // IME users can confirm a character.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    send(event);
  };

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
      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              {messages.length === 0 && !busy && error === undefined && (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageCircle />
                    </EmptyMedia>
                    <EmptyTitle>Talk to the agent</EmptyTitle>
                    <EmptyDescription>
                      Ask about your rack, or how to get the sound you want.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatRow message={message} />
                </MessageScrollerItem>
              ))}
              {thinking && (
                <MessageScrollerItem messageId="thinking">
                  <p
                    role="status"
                    className="shimmer text-sm text-muted-foreground"
                  >
                    Thinking…
                  </p>
                </MessageScrollerItem>
              )}
              {error !== undefined && (
                <MessageScrollerItem messageId="send-error">
                  <Marker role="alert">
                    <MarkerIcon>
                      <CircleAlert />
                    </MarkerIcon>
                    <MarkerContent>{error}</MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <form onSubmit={send} className="p-3">
        <label htmlFor={inputId} className="sr-only">
          Message the agent
        </label>
        <InputGroup className="bg-background">
          <InputGroupTextarea
            id={inputId}
            data-testid="chat-input"
            placeholder="Ask the agent…"
            rows={2}
            className="max-h-40 min-h-16"
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
      </form>
    </aside>
  );
}
