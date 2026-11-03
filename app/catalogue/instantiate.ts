import type {
  Jack,
  LeafRack,
  Method,
  Param,
  ParamGroup,
  ParamValue,
  RackEvent,
} from "../rack/model";
import type { ItemSpec, JackSpec, ParamSpec, ParamSpecGroup } from "./spec";

// A catalogue item placed as a rack: everything the store adds for it, with
// ids of its own.
export type Instance = {
  readonly rack: LeafRack;
  readonly paramGroup: ParamGroup;
  readonly values: Record<string, ParamValue>;
  readonly methods: Record<string, Method>;
  readonly events: Record<string, RackEvent>;
  readonly jacks: Record<string, Jack>;
};

const byId = <T extends { readonly id: string }>(items: readonly T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

export const paramId = (rackId: string, path: readonly string[]) =>
  `${rackId}:param:${path.join(".")}`;

const toParam = (rackId: string, spec: ParamSpec): Param => {
  const { patchable: _, ...param } = spec;
  return {
    ...param,
    id: paramId(rackId, spec.path),
    belongToRackId: rackId,
  } as Param;
};

const toGroup = (
  rackId: string,
  id: string,
  spec: ParamSpecGroup,
): ParamGroup => ({
  id,
  ...(spec.name === undefined ? {} : { name: spec.name }),
  ...(spec.params === undefined
    ? {}
    : { params: spec.params.map((param) => toParam(rackId, param)) }),
  ...(spec.groups === undefined
    ? {}
    : {
        groups: Object.fromEntries(
          Object.entries(spec.groups).map(([key, group]) => [
            key,
            toGroup(rackId, `${id}:${key}`, group),
          ]),
        ),
      }),
});

export const specParams = (group: ParamSpecGroup = {}): ParamSpec[] => [
  ...(group.params ?? []),
  ...Object.values(group.groups ?? {}).flatMap(specParams),
];

const defaultJacks: readonly JackSpec[] = [
  { direction: "in" },
  { direction: "out" },
];

// A jack alone in its direction is the bare `:in` or `:out`, which is what a
// new block and a tree's patches expect; otherwise its key tells it apart.
// A patchable param's jack is apart from these, so no key can take its id.
const toJacks = (rackId: string, spec: ItemSpec): Jack[] => {
  const declared = spec.jacks ?? defaultJacks;
  const alone = (direction: Jack["direction"]) =>
    declared.filter((jack) => jack.direction === direction).length === 1;
  const jacks: Jack[] = declared.map((jack) => ({
    id:
      alone(jack.direction) || jack.key === undefined
        ? `${rackId}:${jack.direction}`
        : `${rackId}:${jack.direction}:${jack.key}`,
    name: jack.name ?? (jack.direction === "in" ? "Input" : "Output"),
    belongToBlockId: rackId,
    direction: jack.direction,
    ...(jack.port === undefined ? {} : { port: jack.port }),
  }));
  const driven: Jack[] = specParams(spec.params)
    .filter((param) => param.patchable === true)
    .map((param) => ({
      id: `${rackId}:mod:${param.path.join(".")}`,
      name: param.name,
      belongToBlockId: rackId,
      direction: "in",
      port: { member: [...param.path] },
    }));
  return [...jacks, ...driven];
};

export const instantiate = (spec: ItemSpec, rackId: string): Instance => {
  const paramGroup = toGroup(rackId, `${rackId}:paramGroup`, spec.params ?? {});
  const values = Object.fromEntries(
    specParams(spec.params).map((param) => [
      paramId(rackId, param.path),
      param.defaultValue,
    ]),
  );

  const methods: Method[] = (spec.methods ?? []).map((method) => ({
    ...method,
    id: `${rackId}:method:${method.method}`,
    belongToBlockId: rackId,
  }));

  const events = (spec.events ?? []).map(
    ({ method, ...event }, index) =>
      ({
        ...event,
        id: `${rackId}:event:${index}`,
        belongToBlockId: rackId,
        methodId: `${rackId}:method:${method}`,
      }) as RackEvent,
  );

  const jacks = toJacks(rackId, spec);

  const rack: LeafRack = {
    id: rackId,
    name: spec.name,
    type: "leaf",
    isRoot: false,
    jackIds: jacks.map((jack) => jack.id),
    paramGroupId: paramGroup.id,
    methodIds: methods.map((method) => method.id),
    eventIds: events.map((event) => event.id),
    code: spec.code,
    ...(spec.readout === undefined ? {} : { readout: spec.readout }),
  };

  return {
    rack,
    paramGroup,
    values,
    methods: byId(methods),
    events: byId(events),
    jacks: byId(jacks),
  };
};
