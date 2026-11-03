import type { Category, ItemSpec } from "../spec";

// A spec field that is present must hold a value, so a helper's spread of
// overrides can't leave `undefined` behind.
const withoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, held]) => held !== undefined)
        .map(([key, held]) => [key, withoutUndefined(held)]),
    );
  }
  return value;
};

type Body = Omit<
  Extract<ItemSpec, { type: "leaf" }>,
  "type" | "category" | "name"
>;

// One catalogue item. Each item file default-exports one of these, or an
// array of them.
export const defineItem = (
  category: Category,
  name: string,
  body: Body,
): ItemSpec =>
  withoutUndefined({ type: "leaf", category, name, ...body }) as ItemSpec;

// Leaf code that builds a node from Tone's `tone.<Class>` with the given
// constructor source, starting it if it is a source that has to run.
export const toneCode = (
  expression: string,
  { start = false }: { readonly start?: boolean } = {},
) => `Effect.gen(function* () {
  const { tone } = yield* RenderContext;
  return ${expression}${start ? ".start()" : ""};
})`;
