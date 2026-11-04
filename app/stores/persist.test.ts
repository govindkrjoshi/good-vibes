// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { storage, useStore } from ".";
import {
  chatKey,
  chatStorage,
  mergeChat,
  noChatKey,
  partializeChat,
} from "./persist";
import { initialRack } from "./rack";

const initial = useStore.getState();

beforeEach(() => {
  useStore.persist.setOptions({ name: noChatKey });
  useStore.setState(initial, true);
});

afterEach(() => {
  storage.flush();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("keeps the rack and the conversation, not errors, play or the catalogue", () => {
  const { rack } = useStore.getState();
  rack.setTransport({ bpm: 90, playing: true });
  rack.reportError("oops");

  const kept = partializeChat(useStore.getState());

  expect(kept.rack.transport).toEqual({ bpm: 90, playing: false });
  expect(kept.rack).not.toHaveProperty("errors");
  expect(kept).not.toHaveProperty("catalogue");
  expect(JSON.parse(JSON.stringify(kept))).toEqual(kept);
});

test("opens a chat it can't read as an empty one, keeping the actions", () => {
  useStore.getState().rack.setTransport({ bpm: 90 });
  const merge = mergeChat(() => chatKey("abc"));

  for (const stored of [undefined, "nope", { rack: {}, chat: {} }]) {
    const merged = merge(stored, useStore.getState());
    expect(merged.rack.transport.bpm).toBe(initialRack.transport.bpm);
    expect(merged.rack.load).toBe(initial.rack.load);
    expect(merged.chat.id).toBe("abc");
    expect(merged.chat.messages).toEqual([]);
  }
});

test("finishes a tool that was still running when the chat was kept", () => {
  const merged = mergeChat(() => chatKey("abc"))(
    {
      rack: partializeChat(initial).rack,
      chat: {
        messages: [
          {
            id: "t",
            role: "assistant",
            kind: "tool",
            text: "Adding",
            pending: true,
          },
        ],
        transcript: [],
      },
    },
    initial,
  );

  expect(merged.chat.messages[0]?.pending).toBe(false);
});

test("writes a moment after the last change, and at once on flush", () => {
  vi.useFakeTimers();
  const kept = chatStorage({ delay: 100, onError: () => {} });
  const value = { state: partializeChat(initial), version: 1 };

  kept.setItem(chatKey("a"), value);
  kept.setItem(chatKey("a"), value);
  expect(localStorage.getItem(chatKey("a"))).toBeNull();
  expect(kept.getItem(chatKey("a"))).toBe(value);

  vi.advanceTimersByTime(100);
  expect(JSON.parse(localStorage.getItem(chatKey("a")) ?? "")).toEqual(value);

  kept.setItem(chatKey("b"), value);
  kept.flush();
  expect(localStorage.getItem(chatKey("b"))).not.toBeNull();
});

test("keeps nothing before a chat is open", () => {
  const kept = chatStorage({ onError: () => {} });

  kept.setItem(noChatKey, { state: partializeChat(initial), version: 1 });
  kept.flush();

  expect(localStorage.length).toBe(0);
});

test("says once when storage refuses a write, and once when it takes one again", () => {
  const onError = vi.fn();
  const kept = chatStorage({ onError });
  const value = { state: partializeChat(initial), version: 1 };
  const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("full", "QuotaExceededError");
  });

  kept.setItem(chatKey("a"), value);
  kept.flush();
  kept.setItem(chatKey("a"), value);
  kept.flush();
  setItem.mockRestore();
  kept.setItem(chatKey("a"), value);
  kept.flush();

  expect(onError.mock.calls).toEqual([
    [expect.stringContaining("could not be saved")],
    [undefined],
  ]);
});
