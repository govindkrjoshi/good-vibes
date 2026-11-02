import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useStore } from ".";
import { attachSandbox, detachSandbox } from "../sandbox/channel";

const initial = useStore.getState();
const postMessage = vi.fn();

beforeEach(() => {
  useStore.setState(initial, true);
  postMessage.mockClear();
  attachSandbox({ postMessage } as unknown as Window);
});

afterEach(detachSandbox);

test("sends the sandbox what a change did to the rack", () => {
  useStore.getState().rack.setParamValue("p", 5);

  expect(postMessage).toHaveBeenCalledExactlyOnceWith(
    { type: "diff", ops: [{ op: "set", path: ["values", "p"], value: 5 }] },
    "*",
  );
});

test("sends what a catalogue item is made of, code as text", () => {
  useStore
    .getState()
    .rack.addRackFromCatalogue("output", "Destination", "root", "D");

  const [message] = postMessage.mock.calls[0] ?? [];
  expect(() => structuredClone(message)).not.toThrow();
  expect(JSON.stringify(message)).toContain("tone.getDestination()");
});

test("sends nothing when the rack's data didn't change", () => {
  useStore.getState().rack.reportError("oops");
  useStore.getState().rack.removePatches([]);

  expect(postMessage).not.toHaveBeenCalled();
});
