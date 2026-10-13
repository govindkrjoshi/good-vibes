import { beforeEach, expect, test } from "vitest";
import { useLayoutStore } from "./layout";

const initial = useLayoutStore.getState();

const state = () => useLayoutStore.getState();
const chatOpen = () => state().chatOpen;

beforeEach(() => {
  useLayoutStore.setState(initial, true);
});

test("starts with the chat open", () => {
  expect(chatOpen()).toBe(true);
});

test("flips the chat on each toggle", () => {
  state().toggleChat();
  expect(chatOpen()).toBe(false);

  state().toggleChat();
  expect(chatOpen()).toBe(true);
});

test("sets the chat open or closed", () => {
  state().setChatOpen(false);
  expect(chatOpen()).toBe(false);
});
