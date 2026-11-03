import type { JackSpec } from "../spec";

// An item with no `jacks` gets one input and one output; these are for the
// items that differ.
export const input = (
  overrides: Omit<JackSpec, "direction"> = {},
): JackSpec => ({
  direction: "in",
  ...overrides,
});

export const output = (
  overrides: Omit<JackSpec, "direction"> = {},
): JackSpec => ({ direction: "out", ...overrides });

// A jack on a property of the node, such as a CrossFade's `a`.
export const memberJack = (
  direction: JackSpec["direction"],
  key: string,
  name: string,
  member: readonly string[] = [key],
): JackSpec => ({ direction, key, name, port: { member: [...member] } });

// A jack on one of the node's numbered inputs or outputs.
export const indexJack = (
  direction: JackSpec["direction"],
  key: string,
  name: string,
  index: number,
): JackSpec => ({ direction, key, name, port: { index } });

// A source makes signal and takes none.
export const sourceJacks = (): JackSpec[] => [output()];
