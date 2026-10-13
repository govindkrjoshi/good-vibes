import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { RackActionSchema } from "./rack-action";
import type { ActionResult, GoodVibesMessage, RackAction } from "./types";

// Sends an action out and waits for whoever applies it to settle it.
export type RequestAction = (
  action: RackAction,
  signal?: AbortSignal,
) => Promise<ActionResult>;

export type ActionRequests = {
  readonly request: RequestAction;
  // Answers a request by the id of its action message.
  readonly settle: (id: string, result: ActionResult) => void;
};

// Keeps the requests waiting on an answer. Each goes out as an action message
// through `publish`, first as requested and again once settled, under one id.
// A request nobody answers fails after `timeoutMs`, so a tool can never hang
// the reply.
export const actionRequests = (
  publish: (message: GoodVibesMessage) => void,
  timeoutMs = 10_000,
): ActionRequests => {
  const waiting = new Map<string, (result: ActionResult) => void>();
  let next = 0;

  const request: RequestAction = (action, signal) =>
    new Promise<ActionResult>((resolve) => {
      const id = `action-${next++}`;
      const finish = (result: ActionResult) => {
        if (!waiting.delete(id)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        publish({
          type: "action",
          id,
          action,
          status: result.ok ? "done" : "failed",
          result,
        });
        resolve(result);
      };
      const onAbort = () =>
        finish({ ok: false, text: "The change was called off." });
      const timer = setTimeout(
        () => finish({ ok: false, text: "Nothing applied the change." }),
        timeoutMs,
      );

      waiting.set(id, finish);
      signal?.addEventListener("abort", onAbort, { once: true });
      publish({ type: "action", id, action, status: "requested" });
    });

  const settle = (id: string, result: ActionResult) =>
    waiting.get(id)?.(result);

  return { request, settle };
};

// What the model gets back from one action: the sentence, then the detail as
// JSON.
export const resultText = ({ text, data }: ActionResult): string =>
  data === undefined ? text : `${text}\n${JSON.stringify(data)}`;

export const rackActionsToolName = "rack_actions";

const parameters = Type.Object({
  actions: Type.Array(RackActionSchema, {
    minItems: 1,
    description: "Applied in order, stopping at the first that is refused.",
  }),
});

// The one tool the model calls: a list of actions, each sent out in turn and
// waited on. A refusal stops the list, since what follows usually builds on
// what was refused, and the model is told how far it got.
export const rackActionsTool = (
  request: RequestAction,
): AgentTool<typeof parameters> => ({
  name: rackActionsToolName,
  label: "Change the rack",
  description:
    "Changes the rack, or looks at it. Takes a list of actions and applies them in order; a block added earlier in the list can be patched or have its params set later in the same list, by the id you gave it.",
  parameters,
  execute: async (_toolCallId, { actions }, signal) => {
    const lines: string[] = [];
    let failed = false;
    for (const [index, action] of actions.entries()) {
      const result = await request(action, signal);
      lines.push(resultText(result));
      if (result.ok) continue;
      failed = true;
      const left = actions.length - index - 1;
      if (left > 0)
        lines.push(
          `Stopped there; the ${left === 1 ? "action" : `${left} actions`} after it ${left === 1 ? "was" : "were"} not applied.`,
        );
      break;
    }
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: undefined,
      isError: failed,
    };
  },
});
