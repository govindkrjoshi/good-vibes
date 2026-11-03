import {
  noteArg,
  patternNames,
  timeArg,
  type AutomationEvent,
  type EventSettings,
  type Method,
  type MethodArg,
  type Param,
  type ParamValue,
  type Transport,
} from "./model";
import { isTime, timeHelp } from "./time";

// What the store does not check: whether a value, event, automation or tempo
// fits what it is for. Each check says what is wrong in words, and says
// nothing when all is well, so a caller can turn a change away before the
// store takes it. See docs/state-validation.md.

const describe = (value: unknown) =>
  typeof value === "string" ? `"${value}"` : String(value);

// Whether a value fits a param: its kind, its range and its options.
export const valueProblems = (param: Param, value: ParamValue): string[] => {
  switch (param.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return [`${param.name} takes a number, not ${describe(value)}`];
      }
      const { min, max } = param;
      if (
        (min !== undefined && value < min) ||
        (max !== undefined && value > max)
      ) {
        const range = [
          min === undefined ? undefined : `at least ${min}`,
          max === undefined ? undefined : `at most ${max}`,
        ]
          .filter((part) => part !== undefined)
          .join(" and ");
        return [`${param.name} must be ${range}, not ${value}`];
      }
      return [];
    }
    case "boolean":
      return typeof value === "boolean"
        ? []
        : [`${param.name} takes true or false, not ${describe(value)}`];
    case "text":
      return typeof value === "string"
        ? []
        : [`${param.name} takes text, not ${describe(value)}`];
    case "select": {
      const options = param.options.map((option) => option.value);
      return options.includes(value)
        ? []
        : [
            `${param.name} must be one of ${options.map(describe).join(", ")}, not ${describe(value)}`,
          ];
    }
  }
};

export const automationProblems = (
  param: Param,
  event: Omit<AutomationEvent, "id">,
): string[] => {
  if (param.kind !== "number" || param.automation === undefined) {
    return [`${param.name} can't be automated`];
  }
  const problems: string[] = [];
  const methods = param.automation.methods;
  if (!methods.includes(event.method)) {
    problems.push(
      `${param.name} can be automated with ${methods.join(", ")}, not ${event.method}`,
    );
  }
  problems.push(
    ...valueProblems(param, event.value).map((held) => `automation ${held}`),
  );
  if (!isTime(event.time)) {
    problems.push(`time ${describe(event.time)} is not a time: ${timeHelp}`);
  }
  if (event.method === "rampTo") {
    if (event.rampTime === undefined) {
      problems.push("rampTo needs a rampTime to ramp over");
    } else if (!isTime(event.rampTime)) {
      problems.push(
        `rampTime ${describe(event.rampTime)} is not a time: ${timeHelp}`,
      );
    }
  }
  return problems;
};

const isStep = (value: unknown) =>
  typeof value === "string" || typeof value === "number";

// Whether a fixed argument fits what the method's signature says of it.
const argProblem = (arg: MethodArg, value: ParamValue): string | undefined => {
  switch (arg.kind) {
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `${arg.name} takes true or false`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${arg.name} takes a number`;
    case "text":
      return typeof value === "string" ? undefined : `${arg.name} takes text`;
    case "time":
      return isTime(value)
        ? undefined
        : `${arg.name} takes a time: ${timeHelp}`;
    case "note":
      return isStep(value)
        ? undefined
        : `${arg.name} takes a note name or a frequency`;
  }
};

// Whether an event can be scheduled on a method, and whether its own
// settings hold up.
export const eventProblems = (
  method: Method,
  event: EventSettings,
): string[] => {
  const problems: string[] = [];
  const when = timeArg(method);
  const note = noteArg(method);
  if (when === undefined) {
    return [`${method.name} has no time argument, so it can't be scheduled`];
  }
  // A stepped event hands its step to the note argument, and on a method
  // with no note argument each step is just a hit. A loop has no steps, so
  // its note has to be fixed, as its value or in args.
  const fixedNote = event.kind === "event" ? event.value : undefined;
  if (
    event.kind === "event" &&
    note !== undefined &&
    fixedNote === undefined &&
    event.args[note.name] === undefined
  ) {
    problems.push(
      `a loop on ${method.name} needs a value or args.${note.name} for ${note.name}`,
    );
  }
  for (const arg of method.args) {
    if (arg === when || (arg === note && event.kind !== "event")) continue;
    if (
      arg === note &&
      (fixedNote !== undefined || event.args[arg.name] === undefined)
    ) {
      continue;
    }
    const value = event.args[arg.name];
    if (value === undefined) {
      if (arg.optional !== true && arg.defaultValue === undefined) {
        problems.push(`args needs ${arg.name} (${arg.kind})`);
      }
      continue;
    }
    const problem = argProblem(arg, value);
    if (problem !== undefined) problems.push(`args: ${problem}`);
  }
  for (const name of Object.keys(event.args)) {
    if (!method.args.some((arg) => arg.name === name)) {
      problems.push(`${method.name} has no argument ${name}`);
    }
  }

  if (
    event.probability !== undefined &&
    !(event.probability >= 0 && event.probability <= 1)
  ) {
    problems.push("probability must be between 0 and 1");
  }
  if (
    event.humanize !== undefined &&
    typeof event.humanize !== "boolean" &&
    !isTime(event.humanize)
  ) {
    problems.push(`humanize must be true, false or a time: ${timeHelp}`);
  }
  if (event.playbackRate !== undefined && !(event.playbackRate > 0)) {
    problems.push("playbackRate must be greater than 0");
  }

  switch (event.kind) {
    case "sequence":
      if (event.steps.length === 0) problems.push("a sequence needs steps");
      if (!isTime(event.subdivision)) {
        problems.push(
          `subdivision ${describe(event.subdivision)} is not a time: ${timeHelp}`,
        );
      }
      break;
    case "pattern":
      if (event.values.length === 0) problems.push("a pattern needs values");
      if (!patternNames.includes(event.pattern)) {
        problems.push(`pattern must be one of ${patternNames.join(", ")}`);
      }
      if (!isTime(event.interval)) {
        problems.push(
          `interval ${describe(event.interval)} is not a time: ${timeHelp}`,
        );
      }
      break;
    case "part":
      if (event.steps.length === 0) problems.push("a part needs steps");
      for (const step of event.steps) {
        if (!isTime(step.time)) {
          problems.push(`step time ${describe(step.time)} is not a time`);
        }
      }
      if (event.loopEnd !== undefined && !isTime(event.loopEnd)) {
        problems.push(`loopEnd ${describe(event.loopEnd)} is not a time`);
      }
      break;
    case "event":
      if (!isTime(event.start)) {
        problems.push(
          `start ${describe(event.start)} is not a time: ${timeHelp}`,
        );
      }
      if (
        typeof event.loop === "number" &&
        !(Number.isInteger(event.loop) && event.loop > 0)
      ) {
        problems.push("loop must be true, false or a whole number of times");
      }
      if (event.loopEnd !== undefined && !isTime(event.loopEnd)) {
        problems.push(`loopEnd ${describe(event.loopEnd)} is not a time`);
      }
      break;
  }
  return problems;
};

export const stepsProblems = (
  steps: readonly (string | number | null)[],
): string[] =>
  steps.length === 0 ? ["a sequence needs at least one step"] : [];

export const transportProblems = (transport: Partial<Transport>): string[] =>
  transport.bpm !== undefined &&
  !(Number.isFinite(transport.bpm) && transport.bpm > 0)
    ? ["bpm must be a number greater than 0"]
    : [];
