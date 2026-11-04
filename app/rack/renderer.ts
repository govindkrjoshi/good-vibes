import { Context, Data, Effect } from "effect";
import type * as ToneJs from "tone";

import { applyRackOps, emptyRackState, type RackOp } from "./diff";
import {
  findParam,
  noteArg,
  paramDrivers,
  rackParams,
  timeArg,
  type AutomationEvent,
  type Param,
  type ParamValue,
  type RackEvent,
  type RackState,
} from "./model";

type ToneNode = ToneJs.ToneAudioNode;

// A level or a value is one number; a spectrum or a waveform is an array.
export type ReadoutValue = number | Float32Array;
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
    // On their own lines, so code ending in a line comment still closes.
    `"use strict"; return (\n${code}\n);`,
  )(Effect, RenderContext, LeafError) as LeafCode;

// One end of a patch: a node, or a part of one a jack's port names, and which
// of its numbered outputs or inputs.
type End = { readonly node: ToneNode; readonly index: number };

type Wire = {
  readonly from: End;
  readonly to: End;
  // The racks whose jacks it joins. An end can be a member of a rack's node,
  // so the node alone doesn't say whose it is.
  readonly racks: { readonly from: string; readonly to: string };
  readonly connected: boolean;
  // The param a wire into one drives, put back when the wire goes.
  readonly drives?: { readonly rackId: string; readonly paramId: string };
};

const sameEnd = (a: End, b: End) => a.node === b.node && a.index === b.index;

// What a rack has become: its mirror of the state and the live objects made
// from it. Everything Tone-side is looked up here when it fires, so rebuilding
// a node doesn't touch the events and automation that play it.
type Env = {
  state: RackState;
  readonly nodes: Map<string, { readonly code: string; node: ToneNode }>;
  // The code of each leaf that failed to build.
  readonly failed: Map<string, string>;
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

// Whether a path names something on a node. A key only has to be there, not
// hold a value: an OmniOscillator's `width` is undefined unless it is a pulse.
// What a node forwards, like a PolySynth's voice settings, is only in `get()`.
const has = (held: unknown, path: readonly string[]): boolean =>
  path.length === 0 ||
  (held !== null &&
    typeof held === "object" &&
    Reflect.has(held, path[0]!) &&
    has((held as Record<string, unknown>)[path[0]!], path.slice(1)));

const reaches = (node: ToneNode, path: readonly string[]) =>
  has(node, path) || has(node.get(), path);

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
    failed: new Map(),
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

  // Tone's `set` drops a key it doesn't know without a word, so a param whose
  // path leads nowhere is reported rather than silently doing nothing.
  const setParam = (node: ToneNode, param: Param, value: ParamValue) =>
    attempt(`${param.name} can't be set`, () => {
      if (!reaches(node, param.path)) {
        throw new Error(`${node.name} has no ${param.path.join(".")}`);
      }
      node.set(nested(param.path, value) as object);
    });

  // A param with a patch into it follows that signal, not its value.
  const isDriven = (paramId: string) =>
    paramDrivers(env.state, paramId).length > 0;

  const setAllParams = (rackId: string, node: ToneNode) => {
    for (const param of rackParams(env.state, rackId)) {
      if (isDriven(param.id)) continue;
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
    // A failed build is remembered so it is only reported once, and tried
    // again only when its code changes.
    if (held === undefined && env.failed.get(rackId) === code) return false;
    env.failed.delete(rackId);

    if (held !== undefined) {
      unwire((wire) => wire.racks.from === rackId || wire.racks.to === rackId);
      disposeNode(held.node);
      env.nodes.delete(rackId);
    }
    if (code !== undefined) {
      env.failed.set(rackId, code);
      attempt(`${rack?.name} can't be built`, () => {
        const node = Effect.runSync(
          Effect.provideService(evalLeafCode(code), RenderContext, { tone }),
        );
        env.failed.delete(rackId);
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
        unwire((wire) => wire.from.node === gain || wire.to.node === gain);
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

  const memberOf = (node: ToneNode, path: readonly string[]) =>
    path.reduce<unknown>(
      (held, key) => (held as Record<string, unknown> | undefined)?.[key],
      node,
    ) as ToneNode | undefined;

  const jackEnd = (jackId: string): End | undefined => {
    const jack = env.state.jacks[jackId];
    if (jack === undefined) return undefined;
    const gain = env.jacks.get(jackId);
    if (gain !== undefined) return { node: gain, index: 0 };
    const node = env.nodes.get(jack.belongToBlockId)?.node;
    if (node === undefined) return undefined;
    const member = jack.port?.member;
    const part = member === undefined ? node : memberOf(node, member);
    return part === undefined
      ? undefined
      : { node: part, index: jack.port?.index ?? 0 };
  };

  // Tone's Param and Signal are what a jack on a param reaches.
  const isParam = (node: unknown) =>
    (tone.Param !== undefined && node instanceof tone.Param) ||
    (tone.Signal !== undefined && node instanceof tone.Signal);

  // The Web Audio node or param under a Tone one. Tone's own disconnect can't
  // see through a Param and drops every cable from the source instead.
  const native = (node: unknown): unknown =>
    isParam(node) ? native((node as { input: unknown }).input) : node;

  const connectEnds = (from: End, to: End) => {
    // A patched param is driven by what comes in, not summed with its value,
    // whether a signal or audio drives it and whether it comes through a tree.
    if (isParam(to.node)) {
      tone.connectSignal(from.node, to.node, from.index, to.index);
    } else {
      from.node.connect(to.node, from.index, to.index);
    }
  };

  const disconnectEnds = (from: End, to: End) => {
    if (isParam(to.node)) {
      (
        from.node as unknown as { disconnect: (...args: unknown[]) => void }
      ).disconnect(native(to.node), from.index);
    } else {
      from.node.disconnect(to.node, from.index, to.index);
    }
  };

  // A param that stops being driven takes its value back. Tone leaves it marked
  // overridden, which keeps it at 0 until that is cleared.
  const restore = ({ rackId, paramId }: NonNullable<Wire["drives"]>) => {
    const node = env.nodes.get(rackId)?.node;
    const param = findParam(env.state, paramId);
    const value = env.state.values[paramId];
    if (node === undefined || param === undefined || isDriven(paramId)) return;
    const target = memberOf(node, param.path) as { overridden?: boolean };
    if (target !== undefined && "overridden" in target)
      target.overridden = false;
    if (value !== undefined) setParam(node, param, value);
  };

  // A pair can be wired by two patches, only through Destinations that share
  // one node; disconnecting one takes the other down, so it gets put back.
  const unwire = (matches: (wire: Wire) => boolean) => {
    const gone = [...env.wires].filter(([, wire]) => matches(wire));
    for (const [id, wire] of gone) {
      env.wires.delete(id);
      if (wire.connected) {
        attempt(`Patch ${id} can't be removed`, () =>
          disconnectEnds(wire.from, wire.to),
        );
      }
    }
    for (const [id, wire] of env.wires) {
      const shared = gone.some(
        ([, was]) => sameEnd(was.from, wire.from) && sameEnd(was.to, wire.to),
      );
      if (shared && wire.connected) {
        attempt(`Patch ${id} can't be put back`, () =>
          connectEnds(wire.from, wire.to),
        );
      }
    }
    for (const [, wire] of gone) if (wire.drives) restore(wire.drives);
  };

  const syncWires = () => {
    const wanted = (id: string) => {
      const patch = env.state.patches[id];
      const from = patch && jackEnd(patch.from);
      const to = patch && jackEnd(patch.to);
      return from && to ? { from, to } : undefined;
    };
    for (const [id, wire] of env.wires) {
      const want = wanted(id);
      if (
        want === undefined ||
        !sameEnd(want.from, wire.from) ||
        !sameEnd(want.to, wire.to)
      ) {
        unwire((held) => held === wire);
      }
    }
    for (const patch of Object.values(env.state.patches)) {
      const want = wanted(patch.id);
      if (want === undefined || env.wires.has(patch.id)) continue;
      // A failed patch is remembered so it is only reported once.
      let connected = false;
      attempt(`${patch.name} can't be patched`, () => {
        connectEnds(want.from, want.to);
        connected = true;
      });
      const racks = {
        from: env.state.jacks[patch.from]!.belongToBlockId,
        to: env.state.jacks[patch.to]!.belongToBlockId,
      };
      const jack = env.state.jacks[patch.to];
      const member = jack?.port?.member;
      const drives =
        jack !== undefined && member !== undefined && isParam(want.to.node)
          ? {
              rackId: jack.belongToBlockId,
              paramId: `${jack.belongToBlockId}:param:${member.join(".")}`,
            }
          : undefined;
      env.wires.set(patch.id, { ...want, racks, connected, drives });
    }
  };

  const syncValue = (paramId: string, rebuilt: ReadonlySet<string>) => {
    const param = findParam(env.state, paramId);
    if (param === undefined || rebuilt.has(param.belongToRackId)) return;
    const node = env.nodes.get(param.belongToRackId)?.node;
    const value = env.state.values[paramId];
    if (node === undefined || value === undefined || isDriven(paramId)) return;
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
      // A ToneEvent with no value plays null, so a loop falls back to its args.
      if (arg === note && value !== undefined && value !== null) return value;
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
    if (param === undefined || node === undefined || isDriven(paramId)) return;
    const target = memberOf(node, param.path) as unknown as Called | undefined;
    // An event already due lands now rather than at a time that has passed.
    const time = Math.max(
      tone.now(),
      start + tone.Time(event.time).toSeconds(),
    );
    attempt(`${param.name} can't be automated`, () =>
      event.method === "rampTo"
        ? target?.rampTo?.(event.value, event.rampTime, time)
        : target?.[event.method]?.(event.value, time),
    );
  };

  // Points handed to a param stay on it until cancelled, and a stopped
  // context keeps the ones yet to fire for the next run. So a list is cleared
  // off the param before it lands again, and the param goes back to its value.
  const clearAutomation = (paramId: string) => {
    const param = findParam(env.state, paramId);
    const node = param && env.nodes.get(param.belongToRackId)?.node;
    if (param === undefined || node === undefined || isDriven(paramId)) return;
    const target = memberOf(node, param.path) as unknown as Called | undefined;
    attempt(`${param.name} can't be cleared`, () =>
      target?.cancelScheduledValues?.(0),
    );
    const value = env.state.values[paramId];
    if (value !== undefined) setParam(node, param, value);
  };

  // A param's whole list lands when the transport starts, each at its own time.
  // The transport only fires a callback whose tick it has yet to reach, so a
  // list changed while it plays also lands right away, from where it started.
  const syncAutomation = (paramId: string) => {
    const transport = tone.getTransport();
    const held = env.automations.get(paramId);
    if (held !== undefined) transport.clear(held);
    env.automations.delete(paramId);
    const events = env.state.automations[paramId] ?? [];
    if (events.length === 0) {
      clearAutomation(paramId);
      return;
    }
    const land = (start: number) => {
      clearAutomation(paramId);
      for (const event of events) automate(paramId, event, start);
    };
    env.automations.set(paramId, transport.schedule(land, 0));
    if (transport.state === "started") land(tone.now() - transport.seconds);
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
      for (const paramId of env.automations.keys()) clearAutomation(paramId);
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
    // A rebuilt node has only plain values, so its automation lands again.
    const automated = touched("automations");
    for (const id of Object.keys(env.state.automations)) {
      const rackId = findParam(env.state, id)?.belongToRackId;
      if (rackId !== undefined && rebuilt.has(rackId)) automated.add(id);
    }
    for (const id of automated) syncAutomation(id);
    syncTransport(prev.transport);
  };

  // What each readout rack's node shows right now. A level reads its first
  // channel, and an array is copied, since Tone refills its own each read.
  const readouts = (): Record<string, ReadoutValue> => {
    const values: Record<string, ReadoutValue> = {};
    for (const [rackId, { node }] of env.nodes) {
      const rack = env.state.racks[rackId];
      if (rack?.type !== "leaf" || rack.readout === undefined) continue;
      const value = (
        node as unknown as { getValue?: () => unknown }
      ).getValue?.();
      if (typeof value === "number") values[rackId] = value;
      else if (Array.isArray(value) && typeof value[0] === "number") {
        values[rackId] = value[0];
      } else if (value instanceof Float32Array) values[rackId] = value.slice();
    }
    return values;
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
    env.failed.clear();
    const prev = env.state.transport;
    env.state = emptyRackState;
    syncTransport(prev);
  };

  return { apply, reset, readouts };
};
