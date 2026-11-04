// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { storage, useStore } from ".";
import {
  chatsStorageKey,
  deleteChat,
  newChat,
  openChat,
  startChats,
  stopChats,
  untitled,
  useChats,
} from "./chats";
import { chatKey, noChatKey } from "./persist";
import { legacyChatStorageKey } from "../agent/history";
import { newTree } from "../rack";

const initial = useStore.getState();

// What a fresh page load starts from, before the kept chats are read.
const freshPage = () => {
  stopChats();
  useStore.persist.setOptions({ name: noChatKey });
  useStore.setState(initial, true);
};

const say = (text: string) =>
  useStore
    .getState()
    .chat.setMessages((list) => [
      ...list,
      { id: `m${list.length}`, role: "user", kind: "message", text },
    ]);

const open = () => useChats.getState().selectedId ?? "";

beforeEach(freshPage);

afterEach(() => {
  freshPage();
  useChats.setState({ chats: [], selectedId: undefined });
  localStorage.clear();
  vi.restoreAllMocks();
});

test("opens a new chat the first time", async () => {
  await startChats();

  expect(useChats.getState().chats).toHaveLength(1);
  expect(useStore.getState().chat.id).toBe(open());
});

test("names a chat by what was first said in it", async () => {
  await startChats();
  say("Build a bass line into the speakers, then add some reverb");

  expect(useChats.getState().chats[0]?.title).toBe(
    "Build a bass line into the speakers, th…",
  );
});

test("opens the chat open last after a reload, reading no other", async () => {
  await startChats();
  say("first");
  const first = open();
  await newChat();
  say("second");
  const second = open();
  await openChat(first);
  storage.flush();

  freshPage();
  const read = vi.spyOn(localStorage, "getItem");
  await startChats();

  expect(open()).toBe(first);
  expect(useStore.getState().chat.messages.map((m) => m.text)).toEqual([
    "first",
  ]);
  const keys = read.mock.calls.map(([key]) => key);
  expect(keys).toContain(chatKey(first));
  expect(keys).not.toContain(chatKey(second));
});

test("loads each chat's rack with it", async () => {
  await startChats();
  useStore.getState().rack.addRack(newTree("t", "root"), "root");
  say("with a tree");
  const first = open();

  await newChat();
  expect(useStore.getState().rack.racks.t).toBeUndefined();

  await openChat(first);
  expect(useStore.getState().rack.racks.t).toBeDefined();
});

test("drops a chat left with nothing in it", async () => {
  await startChats();
  const empty = open();

  await newChat();

  expect(useChats.getState().chats.map((chat) => chat.id)).not.toContain(empty);
});

test("deletes a chat and its rack, opening another in its place", async () => {
  await startChats();
  say("keep me");
  const kept = open();
  await newChat();
  say("delete me");
  const deleted = open();
  storage.flush();

  await deleteChat(deleted);

  expect(localStorage.getItem(chatKey(deleted))).toBeNull();
  expect(useChats.getState().chats.map((chat) => chat.id)).toEqual([kept]);
  expect(open()).toBe(kept);
  expect(useStore.getState().chat.messages[0]?.text).toBe("keep me");
});

test("brings over the conversation kept before there were several", async () => {
  localStorage.setItem(
    legacyChatStorageKey,
    JSON.stringify({
      messages: [{ id: "u", role: "user", kind: "message", text: "old" }],
      transcript: [{ role: "user", content: "old", timestamp: 1 }],
    }),
  );

  await startChats();

  expect(useChats.getState().chats.map((chat) => chat.title)).toEqual(["old"]);
  expect(useStore.getState().chat.messages[0]?.text).toBe("old");
  expect(useStore.getState().chat.transcript).toHaveLength(1);
  expect(localStorage.getItem(legacyChatStorageKey)).toBeNull();
});

test("starts afresh from a list of chats it can't read", async () => {
  localStorage.setItem(chatsStorageKey, "{not json");

  await startChats();

  expect(useChats.getState().chats.map((chat) => chat.title)).toEqual([
    untitled,
  ]);
});
