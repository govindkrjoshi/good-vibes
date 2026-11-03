import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "@earendil-works/pi-ai";
import type { RackStore } from "../types";

type Literals<T extends readonly string[]> = {
  -readonly [K in keyof T]: ReturnType<typeof Type.Literal<T[K]>>;
};

// A choice among fixed strings, typed as the union of them.
export const oneOf = <const T extends readonly string[]>(
  values: T,
  options: { readonly description?: string } = {},
): ReturnType<typeof Type.Union<Literals<T>>> =>
  Type.Union(
    values.map((value) => Type.Literal(value)),
    options,
  ) as unknown as ReturnType<typeof Type.Union<Literals<T>>>;

// What a tool call left behind for the chat: one line on what it did.
export type ToolDetails = { readonly summary: string };

// Why a tool call could not be carried out, in words the model can act on.
export class ToolProblem extends Error {
  constructor(problems: string | readonly string[]) {
    super(
      typeof problems === "string"
        ? problems
        : problems.map((problem) => `- ${problem}`).join("\n"),
    );
    this.name = "ToolProblem";
  }
}

export const refuse = (problems: readonly string[]) => {
  if (problems.length > 0) throw new ToolProblem(problems);
};

export type ToolSpec<P extends TSchema> = {
  readonly name: string;
  // Shown in the chat while the tool runs.
  readonly label: string;
  readonly description: string;
  readonly parameters: P;
  // Returns what was done; the first line is the chat's summary of it.
  // Throw a ToolProblem to carry nothing out and tell the model why.
  readonly run: (args: Static<P>) => string;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const defineTool = <P extends TSchema>(
  spec: ToolSpec<P>,
): AgentTool<P, ToolDetails> => ({
  name: spec.name,
  label: spec.label,
  description: spec.description,
  parameters: spec.parameters,
  execute: async (_id, args) => {
    try {
      const text = spec.run(args);
      return {
        content: [{ type: "text", text }],
        details: { summary: text.split("\n")[0] ?? text },
      };
    } catch (error) {
      const text = messageOf(error);
      return {
        content: [{ type: "text", text }],
        details: { summary: `${spec.label} failed` },
        isError: true,
      };
    }
  },
});

// Store actions report a failure by adding to the rack's errors rather than
// throwing. This watches that list: a tool runs its action through `check`,
// which fails with whatever the action reported; `take` hands over what was
// reported since, such as what the sandbox found once the change reached it.
export type ErrorWatch = {
  readonly check: <T>(action: () => T) => T;
  readonly take: () => string[];
};

export const createErrorWatch = (store: RackStore): ErrorWatch => {
  let seen = store.getState().rack.errors.length;
  const since = () => {
    const { errors } = store.getState().rack;
    // The list only shrinks when the rack is loaded or reset.
    if (errors.length < seen) seen = 0;
    const fresh = errors.slice(seen);
    seen = errors.length;
    return fresh;
  };
  return {
    check: (action) => {
      since();
      const result = action();
      const fresh = since();
      if (fresh.length > 0) throw new ToolProblem(fresh);
      return result;
    },
    take: since,
  };
};
