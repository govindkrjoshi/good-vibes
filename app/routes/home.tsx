import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { cn } from "cn";
import { CanvasChrome } from "../components/canvas-chrome";
import { CanvasViewport } from "../components/canvas-viewport";
import { ChatPanel } from "../components/chat-panel";
import { TopBar } from "../components/top-bar";
import { GoodVibesAgentProvider } from "../hooks/useGoodVibesAgent";
import { useLayoutStore } from "../stores/layout";

export function meta() {
  return [{ title: "Good Vibes" }];
}

// Below this the chat covers the canvas, so it starts closed there.
const narrowScreen = "(max-width: 767px)";

export default function Home() {
  const chatOpen = useLayoutStore((state) => state.chatOpen);
  const setChatOpen = useLayoutStore((state) => state.setChatOpen);

  // The server cannot know the screen size, so this waits for the browser.
  useEffect(() => {
    if (window.matchMedia(narrowScreen).matches) setChatOpen(false);
  }, [setChatOpen]);

  return (
    <ReactFlowProvider>
      <GoodVibesAgentProvider>
        <div className="grid h-screen w-screen grid-rows-[auto_minmax(0,1fr)]">
          <TopBar />
          <div className="relative flex min-h-0">
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
