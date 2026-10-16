import {
  canPatch,
  isRackEvent,
  makeDefaultJacks,
  noteArg,
  timeArg,
  type Jack,
  type Method,
  type Param,
  type ParamGroup,
  type ParamTemplateGroup,
  type ParamValue,
  type RackEvent,
  type RackState,
  type RackTemplate,
  type TreeBlock,
} from "./model";

// What the rack accepts, and how a template becomes the parts of a block.
// Pure functions over rack data; the reducer is their only caller.

const normalizeParamGroup = (
  blockId: string,
  group: ParamTemplateGroup,
): { readonly group: ParamGroup; readonly params: Record<string, Param> } => {
  const entries = Object.entries(group.params ?? {}).map(([key, param]) => {
    const id = `${blockId}:param:${param.path.join(".") || key}`;
    return [key, { ...param, id, belongToBlockId: blockId }] as const;
  });
  const childGroups = Object.entries(group.groups ?? {}).map(
    ([key, childGroup]) =>
      [key, normalizeParamGroup(blockId, childGroup)] as const,
  );

  return {
    group: {
      ...(group.name === undefined ? {} : { name: group.name }),
      ...(entries.length === 0
        ? {}
        : {
            paramIds: Object.fromEntries(
              entries.map(([key, param]) => [key, param.id]),
            ),
          }),
      ...(childGroups.length === 0
        ? {}
        : {
            groups: Object.fromEntries(
              childGroups.map(([key, normalized]) => [key, normalized.group]),
            ),
          }),
    },
    params: Object.fromEntries([
      ...entries.map(([, param]) => [param.id, param] as const),
      ...childGroups.flatMap(([, normalized]) =>
        Object.entries(normalized.params),
      ),
    ]),
  };
};

export const normalizeTemplate = (
  template: RackTemplate,
  blockId: string,
): {
  readonly jacks: readonly Jack[];
  readonly paramIds: ParamGroup;
  readonly methodIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly params: Record<string, Param>;
  readonly methods: Record<string, Method>;
  readonly events: Record<string, RackEvent>;
} => {
  const directions = template.jacks ?? ["in", "out"];
  const jacks = makeDefaultJacks(blockId).filter((jack) =>
    directions.includes(jack.direction),
  );
  const normalizedParams = normalizeParamGroup(blockId, template.params);
  const methods = Object.fromEntries(
    Object.entries(template.methods ?? {}).map(([key, method]) => {
      const id = `${blockId}:method:${key}`;
      return [id, { ...method, id, belongToBlockId: blockId }] as const;
    }),
  );

  const events = Object.fromEntries(
    Object.entries(template.events ?? {}).map(([key, { method, ...event }]) => {
      const id = `${blockId}:event:${key}`;
      const methodId = `${blockId}:method:${method}`;
      return [
        id,
        { ...event, id, methodId, belongToBlockId: blockId },
      ] as const;
    }),
  );

  return {
    jacks,
    paramIds: normalizedParams.group,
    methodIds: Object.keys(methods),
    eventIds: Object.keys(events),
    params: normalizedParams.params,
    methods,
    events,
  };
};

export const resolvePatch = (
  state: RackState,
  fromJackId: string,
  toJackId: string,
):
  | { readonly root: TreeBlock; readonly from: Jack; readonly to: Jack }
  | undefined => {
  const root = state.blocks[state.rootId];
  const from = state.jacks[fromJackId];
  const to = state.jacks[toJackId];

  if (
    root === undefined ||
    root.type !== "tree" ||
    from === undefined ||
    to === undefined ||
    !canPatch(root, from, to)
  ) {
    return undefined;
  }

  return { root, from, to };
};

// A value is only kept when it fits the param it is for: the right type, a
// number clamped into range, a select value that is one of its options.
export const acceptValue = (
  param: Param | undefined,
  value: ParamValue,
): ParamValue | undefined => {
  switch (param?.kind) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value))
        return undefined;
      return Math.min(
        param.max ?? Infinity,
        Math.max(param.min ?? -Infinity, value),
      );
    }
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "text":
      return typeof value === "string" ? value : undefined;
    case "select":
      return param.options.some((option) => option.value === value)
        ? value
        : undefined;
    default:
      return undefined;
  }
};

// Seconds, a musical length like 4n, 8t or 1m, or bars:beats:sixteenths,
// optionally after a "+". The same shapes Tone reads as a time from now.
const TIME =
  /^\+?(?:(?:\d+\.?\d*|\.\d+)(?:n\.?|t|m|s|i|hz)?|\d+:\d+(?::\d+(?:\.\d+)?)?)$/;
export const isTime = (time: string) => TIME.test(time.trim());

// An event is only kept when its method can take the time Tone fires it at,
// and, for the kinds that step through values, a note to put each value in.
// Every time is checked here because a bad one would only throw once Tone
// fires it, inside a transport callback, where nothing can catch it.
export const acceptEvent = (
  method: Method | undefined,
  event: RackEvent,
): RackEvent | undefined => {
  if (
    method === undefined ||
    !isRackEvent(event) ||
    timeArg(method) === undefined ||
    (event.kind !== "event" && noteArg(method) === undefined)
  ) {
    return undefined;
  }

  // The time, and the note when the event has values, are filled in when it
  // fires; every other required argument has to be fixed up front, as a
  // method call would need it. A loop has no value, so its note is fixed.
  const fixedNote = event.kind === "event" && event.value === undefined;
  const missing = method.args.some(
    (arg) =>
      arg.optional !== true &&
      arg !== timeArg(method) &&
      (fixedNote || arg !== noteArg(method)) &&
      event.args[arg.name] === undefined,
  );
  const knobsFit =
    (event.probability === undefined ||
      (event.probability >= 0 && event.probability <= 1)) &&
    (typeof event.humanize !== "string" || isTime(event.humanize));
  if (missing || !knobsFit) return undefined;

  switch (event.kind) {
    case "sequence":
      return event.steps.length > 0 && isTime(event.subdivision)
        ? event
        : undefined;
    case "event": {
      const loopFits =
        event.loop === false ||
        (event.loopEnd !== undefined &&
          isTime(event.loopEnd) &&
          (event.loop === true ||
            (Number.isInteger(event.loop) && event.loop > 0)));
      return isTime(event.start) && loopFits ? event : undefined;
    }
    case "pattern":
      return event.values.length > 0 && isTime(event.interval)
        ? event
        : undefined;
    case "part":
      return event.steps.length > 0 &&
        event.steps.every((step) => isTime(step.time)) &&
        (event.loopEnd === undefined || isTime(event.loopEnd))
        ? event
        : undefined;
  }
};
