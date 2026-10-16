import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { RackActionSchema } from "./rack-action";
import type { ActionResult, GoodVibesMessage, RackAction } from "./types";

// Carries out one action the model asked for, and says what came of it. The
// agent never touches the rack: whoever makes the agent hands this in.
export type ApplyAction = (
  action: RackAction,
  signal?: AbortSignal,
) => Promise<ActionResult> | ActionResult;

export type RequestAction = (
  action: RackAction,
  signal?: AbortSignal,
) => Promise<ActionResult>;

// Applies each action between two action messages through `publish`: one as
// it is asked for, one with what came of it, under one id, so the chat can
// show it working. Applying that throws, or a reply that is aborted first,
// still comes back as a result, so the model is never left waiting.
const calledOff: ActionResult = {
  ok: false,
  text: "The change was called off.",
};

export const announced = (
  publish: (message: GoodVibesMessage) => void,
  apply: ApplyAction,
): RequestAction => {
  let next = 0;
  return async (action, signal) => {
    const id = `action-${next++}`;
    // Read when needed: the reply can be aborted while the action runs.
    const aborted = () => signal?.aborted === true;
    publish({ type: "action", id, action, status: "requested" });
    const result: ActionResult = await (async () => {
      if (aborted()) return calledOff;
      try {
        return await apply(action, signal);
      } catch (error) {
        return aborted()
          ? calledOff
          : {
              ok: false,
              text:
                error instanceof Error
                  ? error.message
                  : "The change could not be made",
            };
      }
    })();
    publish({
      type: "action",
      id,
      action,
      status: result.ok ? "done" : "failed",
      result,
    });
    return result;
  };
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

// The one tool the model calls: a list of actions, each applied in turn and
// waited on. A refusal stops the list, since what follows usually builds on
// what was refused, and the model is told how far it got.
export const rackActionsTool = (
  request: RequestAction,
): AgentTool<typeof parameters> => ({
  name: rackActionsToolName,
  label: "Change the rack",
  description:
    "Changes the rack, looks at it, or checks it for errors. Takes a list of actions and applies them in order, each one whole or not at all; a block added earlier in the list can be patched or have its params set later in the same list, by the id you gave it. A refusal stops the list there.",
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
