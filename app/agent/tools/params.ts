import { Type } from "@earendil-works/pi-ai";
import {
  automationProblems,
  paramDrivers,
  rampMethods,
  valueProblems,
} from "../../rack";
import type { RackStore } from "../types";
import { paramOf } from "./lookup";
import {
  defineTool,
  oneOf,
  refuse,
  ToolProblem,
  type ErrorWatch,
} from "./tool";

const ParamValueSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
]);

export const paramTools = (store: RackStore, watch: ErrorWatch) => [
  defineTool({
    name: "set_params",
    label: "Setting params",
    description:
      "Sets param values, by the ids read_rack shows (rack:param:path). A value has to fit its param's kind, range or options; nothing is set if any doesn't.",
    parameters: Type.Object({
      values: Type.Array(
        Type.Object({ paramId: Type.String(), value: ParamValueSchema }),
      ),
    }),
    run: ({ values }) => {
      const { rack } = store.getState();
      const changes = values.map(({ paramId, value }) => ({
        param: paramOf(rack, paramId),
        value,
      }));
      refuse(
        changes.flatMap(({ param, value }) => valueProblems(param, value)),
      );
      for (const { param, value } of changes) {
        watch.check(() => rack.setParamValue(param.id, value));
      }
      const lines = changes.map(({ param, value }) => {
        const drivers = paramDrivers(rack, param.id);
        return `${param.id} = ${JSON.stringify(value)}${
          drivers.length === 0
            ? ""
            : ` (driven by ${drivers.join(", ")} for now, so the value waits)`
        }`;
      });
      return [`Set ${changes.length} param(s).`, ...lines].join("\n");
    },
  }),
  defineTool({
    name: "add_automation",
    label: "Scheduling a param change",
    description:
      "Schedules a change to a number param when the transport plays, named after the Tone.js call that makes it. time is when it lands (or when a ramp-to-value ends); rampTo ramps over rampTime starting at time. The param's automation methods say which calls it takes.",
    parameters: Type.Object({
      paramId: Type.String(),
      method: oneOf(rampMethods),
      value: Type.Number(),
      time: Type.String({ description: "Such as 0, 4n, 1m or 2:0:0." }),
      rampTime: Type.Optional(Type.String({ description: "rampTo only." })),
    }),
    run: ({ paramId, method, value, time, rampTime }) => {
      const { rack } = store.getState();
      const param = paramOf(rack, paramId);
      const event = {
        method,
        value,
        time,
        ...(rampTime === undefined ? {} : { rampTime }),
      };
      refuse(automationProblems(param, event));
      const id = watch.check(() => rack.addAutomation(paramId, event));
      return `Scheduled [${id}] ${method} ${value} on ${paramId} at ${time}${
        rampTime === undefined ? "" : ` over ${rampTime}`
      }.`;
    },
  }),
  defineTool({
    name: "remove_automation",
    label: "Removing a scheduled change",
    description: "Removes a scheduled param change by its id.",
    parameters: Type.Object({
      paramId: Type.String(),
      automationId: Type.String(),
    }),
    run: ({ paramId, automationId }) => {
      const { rack } = store.getState();
      paramOf(rack, paramId);
      const held = rack.automations[paramId] ?? [];
      if (!held.some((event) => event.id === automationId)) {
        throw new ToolProblem(`${paramId} has no automation ${automationId}.`);
      }
      watch.check(() => rack.removeAutomation(paramId, automationId));
      return `Removed automation ${automationId} from ${paramId}.`;
    },
  }),
];
