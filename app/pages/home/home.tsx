import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { cn } from "cn";
import { CanvasChrome } from "../../components/canvas/chrome";
import { CanvasViewport } from "../../components/canvas/viewport";
import { ChatPanel } from "../../components/chat/chat-panel";
import { TopBar } from "../../components/shell/top-bar";
import { GoodVibesAgentProvider } from "../../components/chat/agent-provider";

export function meta() {
  return [{ title: "Good Vibes" }];
}

// Below this the chat covers the canvas, so it starts closed there.
const narrowScreen = "(max-width: 767px)";

export default function Home() {
  const [chatOpen, setChatOpen] = useState(true);

  // The server cannot know the screen size, so this waits for the browser.
  useEffect(() => {
    if (window.matchMedia(narrowScreen).matches) setChatOpen(false);
  }, []);

  return (
    <ReactFlowProvider>
      <GoodVibesAgentProvider>
        <div className="grid h-screen w-screen grid-rows-[auto_minmax(0,1fr)]">
          <TopBar
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((open) => !open)}
          />
          <div className="relative flex min-h-0">
            {chatOpen && (
              // On a phone the chat covers the canvas; a tap beside it
              // closes it, as the top bar's toggle does.
              <button
                type="button"
                aria-label="Hide chat"
                data-testid="chat-scrim"
                className="absolute inset-0 z-10 bg-foreground/30 md:hidden"
                onClick={() => setChatOpen(false)}
              />
            )}
            <ChatPanel
              className={cn(
                "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-20 max-md:shadow-lg",
                !chatOpen && "hidden",
              )}
            />
            <main className="@container/canvas relative min-w-0 flex-1 overflow-hidden">
              <CanvasViewport />
              <CanvasChrome />
            </main>
          </div>
        </div>
      </GoodVibesAgentProvider>
    </ReactFlowProvider>
  );
}
