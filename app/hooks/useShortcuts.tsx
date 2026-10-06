import { useEffect, useRef } from "react";

export type Shortcuts = Readonly<Record<string, () => void>>;

const typingTags = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || typingTags.has(target.tagName);
}

export function useShortcuts(shortcuts: Shortcuts) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const handler = latest.current[event.key.toLowerCase()];
      if (handler === undefined) return;

      event.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
