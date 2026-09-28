import { useEffect, useRef } from "react";

/** Handlers keyed by the lower-case `event.key` that triggers them. */
export type Shortcuts = Readonly<Record<string, () => void>>;

const typingTags = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || typingTags.has(target.tagName);
}

/**
 * Binds single-key canvas shortcuts on the window. The handlers are read
 * through a ref, so passing a fresh object each render rebinds nothing.
 */
export function useShortcuts(shortcuts: Shortcuts) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Leave modified keys to the browser and to React Flow.
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
