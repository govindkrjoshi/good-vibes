import { instantiate, paramId } from "../catalogue/instantiate";
import type { Registry } from "../catalogue/registry";
import {
  patchScope,
  rootRack,
  type EventSettings,
  type Jack,
  type LeafRack,
  type Method,
  type ParamGroup,
  type ParamValue,
  type Patch,
  type Rack,
  type RackEvent,
  type RackState,
  type TreeRack,
} from "../rack/model";

// Builds a whole RackState by hand, with the ids chosen up front so the racks
// can be patched by name. Anything that doesn't fit, such as a param path an
// item lacks or a patch between jacks that can't reach, throws, so a demo
// that builds is one the store can hold and the renderer can play.

// An event as a demo writes it: the method it calls and its settings.
export type DemoEvent = EventSettings & { readonly method: string };

type Placement = {
  readonly parentId?: string;
  // What the rack is for; the panel shows it alongside the item's name.
  readonly name?: string;
  // Param values by their dotted path, such as `envelope.attack`.
  readonly values?: Readonly<Record<string, ParamValue>>;
  // Replaces the item's own events.
  readonly events?: readonly DemoEvent[];
};

type Tree = Omit<TreeRack, "children" | "patches"> & {
  children: string[];
  patches: string[];
};

const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

// Jack ids as the catalogue and the store name them.
export const out = (rackId: string, key?: string) =>
  key === undefined ? `${rackId}:out` : `${rackId}:out:${key}`;

export const inp = (rackId: string, key?: string) =>
  key === undefined ? `${rackId}:in` : `${rackId}:in:${key}`;

// The jack a patchable param is driven through.
export const mod = (rackId: string, path: string) => `${rackId}:mod:${path}`;

type Args = Readonly<Record<string, ParamValue>>;
type Step = string | number | null;

const triggered = "triggerAttackRelease";

// A step sequence on a subdivision; a null step is a rest.
export const seq = (
  steps: readonly Step[],
  subdivision: string,
  args: Args,
  extra: Partial<Pick<DemoEvent, "probability" | "humanize">> = {},
): DemoEvent => ({
  method: triggered,
  kind: "sequence",
  steps,
  subdivision,
  args,
  mute: false,
  ...extra,
});

// Notes at bar:beat times, looping over `loopEnd`.
export const part = (
  steps: readonly (readonly [string, string | number])[],
  loopEnd: string,
  args: Args,
): DemoEvent => ({
  method: triggered,
  kind: "part",
  steps: steps.map(([time, value]) => ({ time, value })),
  loopEnd,
  args,
  mute: false,
});

// Every note of a chord at one time, for a part.
export const chord = (
  time: string,
  notes: readonly string[],
): (readonly [string, string])[] => notes.map((note) => [time, note] as const);

// Steps picked from a set of values in one of Tone's pattern orders.
export const pattern = (
  values: readonly (string | number)[],
  order: Extract<DemoEvent, { kind: "pattern" }>["pattern"],
  interval: string,
  args: Args,
  extra: Partial<Pick<DemoEvent, "probability" | "humanize">> = {},
): DemoEvent => ({
  method: triggered,
  kind: "pattern",
  values,
  pattern: order,
  interval,
  args,
  mute: false,
  ...extra,
});

// One trigger every `loopEnd`, from the start.
export const every = (loopEnd: string, args: Args): DemoEvent => ({
  method: triggered,
  kind: "event",
  start: "0",
  loop: true,
  loopEnd,
  args,
  mute: false,
});

export class DemoBuilder {
  private readonly trees: Record<string, Tree> = {
    [rootRack.id]: { ...rootRack, children: [], patches: [] },
  };
  private readonly leaves: Record<string, LeafRack> = {};
  private readonly jacks: Record<string, Jack> = {};
  private readonly paramGroups: Record<string, ParamGroup> = {};
  private readonly methods: Record<string, Method> = {};
  private readonly values: Record<string, ParamValue> = {};
  private readonly events: Record<string, RackEvent> = {};
  private readonly patches: Record<string, Patch> = {};

  constructor(
    private readonly registry: Registry,
    private readonly bpm: number,
  ) {}

  private racks(): Record<string, Rack> {
    return { ...this.trees, ...this.leaves };
  }

  private parent(parentId: string, childId: string): Tree {
    const held = this.trees[parentId];
    if (held === undefined) {
      throw new Error(`${childId} can't go in ${parentId}, which is no tree`);
    }
    if (parentId in this.leaves || childId in this.racks()) {
      throw new Error(`there is already a rack ${childId}`);
    }
    return held;
  }

  // A group with jacks named for what passes through them.
  tree(
    id: string,
    name: string,
    {
      parentId = rootRack.id,
      inputs = [],
      outputs = [],
    }: {
      readonly parentId?: string;
      readonly inputs?: readonly string[];
      readonly outputs?: readonly string[];
    } = {},
  ): string {
    const parent = this.parent(parentId, id);
    const jacks: Jack[] = [
      ...inputs.map((label): Jack => ({
        id: inp(id, slug(label)),
        name: label,
        belongToBlockId: id,
        direction: "in",
      })),
      ...outputs.map((label): Jack => ({
        id: out(id, slug(label)),
        name: label,
        belongToBlockId: id,
        direction: "out",
      })),
    ];
    for (const jack of jacks) this.jacks[jack.id] = jack;
    this.trees[id] = {
      id,
      name,
      type: "tree",
      isRoot: false,
      parentId,
      jackIds: jacks.map((jack) => jack.id),
      methodIds: [],
      eventIds: [],
      children: [],
      patches: [],
    };
    parent.children.push(id);
    return id;
  }

  // A catalogue item placed under `id`, with its values and events set.
  add(
    key: string,
    id: string,
    { parentId = rootRack.id, name, values = {}, events }: Placement = {},
  ): string {
    const parent = this.parent(parentId, id);
    const spec = this.registry.items[key];
    if (spec === undefined) throw new Error(`${key} is not in the catalogue`);
    const placed = instantiate(spec, id);

    for (const [path, value] of Object.entries(values)) {
      const held = paramId(id, path.split("."));
      if (!(held in placed.values)) {
        throw new Error(`${key} has no param ${path}`);
      }
      placed.values[held] = value;
    }

    const held =
      events === undefined
        ? placed.events
        : Object.fromEntries(
            events.map(({ method, ...settings }, index) => {
              const methodId = `${id}:method:${method}`;
              if (!(methodId in placed.methods)) {
                throw new Error(`${key} has no method ${method}`);
              }
              const eventId = `${id}:event:${index}`;
              const event = {
                ...settings,
                id: eventId,
                belongToBlockId: id,
                methodId,
              } as RackEvent;
              return [eventId, event];
            }),
          );

    this.leaves[id] = {
      ...placed.rack,
      parentId,
      name: name === undefined ? spec.name : `${name} · ${spec.name}`,
      eventIds: Object.keys(held),
    };
    parent.children.push(id);
    Object.assign(this.jacks, placed.jacks);
    this.paramGroups[placed.paramGroup.id] = placed.paramGroup;
    Object.assign(this.methods, placed.methods);
    Object.assign(this.values, placed.values);
    Object.assign(this.events, held);
    return id;
  }

  // A cable between two jacks, held by the tree it crosses.
  patch(from: string, to: string): void {
    const a = this.jacks[from];
    const b = this.jacks[to];
    if (a === undefined) throw new Error(`there is no jack ${from}`);
    if (b === undefined) throw new Error(`there is no jack ${to}`);
    const scopeId = patchScope(this.racks(), a, b);
    const scope = scopeId === undefined ? undefined : this.trees[scopeId];
    if (scope === undefined) {
      throw new Error(`${from} can't be patched to ${to}`);
    }
    const id = `${from}>${to}`;
    this.patches[id] = { id, name: `${a.name} to ${b.name}`, from, to };
    scope.patches.push(id);
  }

  // Racks in a row, each one's output into the next one's input.
  chain(...rackIds: readonly string[]): void {
    rackIds.forEach((rackId, index) => {
      const next = rackIds[index + 1];
      if (next !== undefined) this.patch(out(rackId), inp(next));
    });
  }

  build(): RackState {
    return {
      racks: this.racks(),
      jacks: { ...this.jacks },
      paramGroups: { ...this.paramGroups },
      methods: { ...this.methods },
      values: { ...this.values },
      automations: {},
      patches: { ...this.patches },
      events: { ...this.events },
      transport: { bpm: this.bpm, playing: false },
      rootId: rootRack.id,
    };
  }
}
