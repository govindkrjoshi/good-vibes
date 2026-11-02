import { Context, Data, Effect } from "effect";
import type * as ToneJs from "tone";

import { applyRackOps, emptyRackState, type RackOp } from "./diff";
import {
  findParam,
  noteArg,
  rackParams,
  timeArg,
  type AutomationEvent,
  type Param,
  type ParamValue,
  type RackEvent,
  type RackState,
} from "./model";

type ToneNode = ToneJs.ToneAudioNode;
type Tone = typeof ToneJs;

// What leaf code renders with, handed to it as a service.
export class RenderContext extends Context.Service<
  RenderContext,
  { readonly tone: Tone }
>()("RenderContext") {}

export class LeafError extends Data.TaggedError("LeafError")<{
  readonly message: string;
}> {}

// What a leaf block runs to make its Tone.js node. Param values are applied
// by the renderer afterwards, so the code only has to construct the node.
export type LeafCode = Effect.Effect<ToneNode, LeafError, RenderContext>;

// A rack's code is the source of an expression, seeing only these names.
export const evalLeafCode = (code: string): LeafCode =>
  new Function(
    "Effect",
    "RenderContext",
    "LeafError",
    `"use strict"; return (${code});`,
  )(Effect, RenderContext, LeafError) as LeafCode;

type Wire = {
  readonly from: ToneNode;
  readonly to: ToneNode;
  readonly connected: boolean;
};

// What a rack has become: its mirror of the state and the live objects made
// from it. Everything Tone-side is looked up here when it fires, so rebuilding
// a node doesn't touch the events and automation that play it.
type Env = {
  state: RackState;
  readonly nodes: Map<string, { readonly code: string; node: ToneNode }>;
  readonly jacks: Map<string, ToneNode>;
  readonly wires: Map<string, Wire>;
  readonly events: Map<string, { dispose(): unknown }>;
  readonly automations: Map<string, number>;
};

type Called = Record<string, (...args: unknown[]) => unknown>;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// { path: ["envelope", "attack"] } as { envelope: { attack: value } }.
const nested = (path: readonly string[], value: ParamValue) =>
  path.reduceRight<unknown>((held, key) => ({ [key]: held }), value);

export const createRenderer = ({
  tone,
  report,
}: {
  readonly tone: Tone;
  readonly report: (message: string) => void;
}) => {
  const env: Env = {
    state: emptyRackState,
    nodes: new Map(),
    jacks: new Map(),
    wires: new Map(),
    events: new Map(),
    automations: new Map(),
  };

  const attempt = (what: string, run: () => void) => {
    try {
      run();
    } catch (error) {
      report(`${what}: ${messageOf(error)}`);
    }
  };

  const setParam = (node: ToneNode, param: Param, value: ParamValue) =>
    attempt(`${param.name} can't be set`, () =>
      node.set(nested(param.path, value) as object),
    );

  const setAllParams = (rackId: string, node: ToneNode) => {
    for (const param of rackParams(env.state, rackId)) {
      const value = env.state.values[param.id];
      if (value !== undefined) setParam(node, param, value);
    }
  };

  // The speakers are shared by every Destination, so they outlive any of them.
  const disposeNode = (node: ToneNode) => {
    if (node !== tone.getDestination()) node.dispose();
  };

  const syncRack = (rackId: string): boolean => {
    const rack = env.state.racks[rackId];
    const held = env.nodes.get(rackId);
    const code = rack?.type === "leaf" ? rack.code : undefined;
    if (held?.code === code) return false;

    if (held !== undefined) {
      unwire((wire) => wire.from === held.node || wire.to === held.node);
      disposeNode(held.node);
      env.nodes.delete(rackId);
    }
    if (code !== undefined) {
      attempt(`${rack?.name} can't be built`, () => {
        const node = Effect.runSync(
          Effect.provideService(evalLeafCode(code), RenderContext, { tone }),
        );
        env.nodes.set(rackId, { code, node });
        setAllParams(rackId, node);
      });
    }
    return true;
  };

  // A tree has no node of its own: each of its jacks passes signal through.
  const syncJacks = () => {
    const { jacks, racks } = env.state;
    for (const [id, gain] of env.jacks) {
      if (jacks[id] === undefined) {
        unwire((wire) => wire.from === gain || wire.to === gain);
        gain.dispose();
        env.jacks.delete(id);
      }
    }
    for (const jack of Object.values(jacks)) {
      const isTree = racks[jack.belongToBlockId]?.type === "tree";
      if (isTree && !env.jacks.has(jack.id)) {
        env.jacks.set(jack.id, new tone.Gain());
      }
    }
  };

  const jackNode = (jackId: string): ToneNode | undefined => {
    const owner = env.state.jacks[jackId]?.belongToBlockId;
    if (owner === undefined) return undefined;
    return env.jacks.get(jackId) ?? env.nodes.get(owner)?.node;
  };

  // A pair can be wired by two patches, only through Destinations that share
  // one node; disconnecting one takes the other down, so it gets put back.
  const unwire = (matches: (wire: Wire) => boolean) => {
    const gone = [...env.wires].filter(([, wire]) => matches(wire));
    for (const [id, wire] of gone) {
      env.wires.delete(id);
      if (wire.connected) wire.from.disconnect(wire.to);
    }
    for (const wire of env.wires.values()) {
      const shared = gone.some(
        ([, was]) => was.from === wire.from && was.to === wire.to,
      );
      if (shared && wire.connected) wire.from.connect(wire.to);
    }
  };

  const syncWires = () => {
    const wanted = (id: string) => {
      const patch = env.state.patches[id];
      const from = patch && jackNode(patch.from);
      const to = patch && jackNode(patch.to);
      return from && to ? { from, to } : undefined;
    };
    for (const [id, wire] of env.wires) {
      const want = wanted(id);
      if (want?.from !== wire.from || want?.to !== wire.to) {
        unwire((held) => held === wire);
      }
    }
    for (const patch of Object.values(env.state.patches)) {
      const want = wanted(patch.id);
      if (want === undefined || env.wires.has(patch.id)) continue;
      // A failed patch is remembered so it is only reported once.
      let connected = false;
      attempt(`${patch.name} can't be patched`, () => {
        want.from.connect(want.to);
        connected = true;
      });
      env.wires.set(patch.id, { ...want, connected });
    }
  };

  const syncValue = (paramId: string, rebuilt: ReadonlySet<string>) => {
    const param = findParam(env.state, paramId);
    if (param === undefined || rebuilt.has(param.belongToRackId)) return;
    const node = env.nodes.get(param.belongToRackId)?.node;
    const value = env.state.values[paramId];
    if (node === undefined || value === undefined) return;
    // What a param means can depend on a choice, like an oscillator's type.
    if (param.kind === "select") setAllParams(param.belongToRackId, node);
    else setParam(node, param, value);
  };

  const fire = (event: RackEvent, time: number, value: unknown) => {
    const method = env.state.methods[event.methodId];
    const node = env.nodes.get(event.belongToBlockId)?.node;
    if (method === undefined || node === undefined) return;
    const when = timeArg(method);
    const note = noteArg(method);
    const args = method.args.map((arg) => {
      if (arg === when) return time;
      if (arg === note && value !== undefined) return value;
      return event.args[arg.name] ?? arg.defaultValue;
    });
    attempt(`${method.name} failed`, () =>
      (node as unknown as Called)[method.method]?.apply(node, args),
    );
  };

  const buildEvent = (event: RackEvent) => {
    const play = (time: number, value?: unknown) => fire(event, time, value);
    switch (event.kind) {
      case "sequence":
        return new tone.Sequence(
          play,
          [...event.steps],
          event.subdivision,
        ).start(0);
      case "event": {
        const built = new tone.ToneEvent(play, event.value);
        built.loop = event.loop;
        if (event.loopEnd !== undefined) built.loopEnd = event.loopEnd;
        return built.start(event.start);
      }
      case "pattern": {
        const built = new tone.Pattern(play, [...event.values], event.pattern);
        built.interval = event.interval;
        return built.start(0);
      }
      case "part": {
        const built = new tone.Part(
          (time, step: { readonly value: unknown }) => {
            if (step.value !== null) play(time, step.value);
          },
          event.steps.map((step) => ({ ...step })),
        );
        if (event.loopEnd !== undefined) {
          built.loop = true;
          built.loopEnd = event.loopEnd;
        }
        return built.start(0);
      }
    }
  };

  const syncEvent = (eventId: string) => {
    env.events.get(eventId)?.dispose();
    env.events.delete(eventId);
    const event = env.state.events[eventId];
    if (event === undefined || event.mute) return;
    attempt(`Event ${eventId} can't be scheduled`, () => {
      const built = buildEvent(event);
      if (event.probability !== undefined) {
        built.probability = event.probability;
      }
      if (event.humanize !== undefined) built.humanize = event.humanize;
      if (event.playbackRate !== undefined) {
        built.playbackRate = event.playbackRate;
      }
      env.events.set(eventId, built);
    });
  };

  const automate = (paramId: string, event: AutomationEvent, start: number) => {
    const param = findParam(env.state, paramId);
    const node = param && env.nodes.get(param.belongToRackId)?.node;
    if (param === undefined || node === undefined) return;
    const target = param.path.reduce<unknown>(
      (held, key) => (held as Record<string, unknown> | undefined)?.[key],
      node,
    ) as Called | undefined;
    const time = start + tone.Time(event.time).toSeconds();
    attempt(`${param.name} can't be automated`, () =>
      event.method === "rampTo"
        ? target?.rampTo?.(event.value, event.rampTime, time)
        : target?.[event.method]?.(event.value, time),
    );
  };

  // A param's whole list lands when the transport starts, each at its own time.
  const syncAutomation = (paramId: string) => {
    const transport = tone.getTransport();
    const held = env.automations.get(paramId);
    if (held !== undefined) transport.clear(held);
    env.automations.delete(paramId);
    const events = env.state.automations[paramId] ?? [];
    if (events.length === 0) return;
    env.automations.set(
      paramId,
      transport.schedule((start) => {
        for (const event of events) automate(paramId, event, start);
      }, 0),
    );
  };

  const syncTransport = (prev: RackState["transport"]) => {
    const { bpm, playing } = env.state.transport;
    const transport = tone.getTransport();
    if (bpm !== prev.bpm) transport.bpm.value = bpm;
    if (playing === prev.playing) return;
    if (playing) {
      tone.start().then(
        () => {
          if (env.state.transport.playing) transport.start();
        },
        (error: unknown) => report(`Audio can't start: ${messageOf(error)}`),
      );
    } else {
      transport.stop();
      // Oscillators run regardless of the transport; only this silences them.
      void (tone.getContext().rawContext as AudioContext).suspend();
    }
  };

  const apply = (ops: readonly RackOp[]) => {
    const prev = env.state;
    env.state = applyRackOps(prev, ops);

    const touched = (field: keyof RackState) =>
      new Set(
        ops.flatMap(({ path: [held, id] }) =>
          held === field && id !== undefined ? [id] : [],
        ),
      );
    const racks = touched("racks");
    const rebuilt = new Set([...racks].filter(syncRack));
    if (racks.size > 0 || touched("jacks").size > 0) syncJacks();
    for (const id of touched("values")) syncValue(id, rebuilt);
    syncWires();
    for (const id of touched("events")) syncEvent(id);
    for (const id of touched("automations")) syncAutomation(id);
    syncTransport(prev.transport);
  };

  const reset = () => {
    const transport = tone.getTransport();
    for (const event of env.events.values()) event.dispose();
    for (const id of env.automations.values()) transport.clear(id);
    unwire(() => true);
    for (const gain of env.jacks.values()) gain.dispose();
    for (const { node } of env.nodes.values()) disposeNode(node);
    env.events.clear();
    env.automations.clear();
    env.jacks.clear();
    env.nodes.clear();
    const prev = env.state.transport;
    env.state = emptyRackState;
    syncTransport(prev);
  };

  return { apply, reset };
};
