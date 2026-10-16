import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { StoreApi } from "zustand";
import { applyAction, checkAfterTurn, type ActionDeps } from "./actions";
import { makeAgentService, type AgentService, type CreateAgent } from "./agent";
import { record, type DebugLog } from "./debug/log";
import { onDispatch, onRackWork, rackStore, type RackStore } from "./rack";
import {
  makeSandboxClient,
  sandboxStatus,
  type SandboxClient,
} from "./sandbox";

// The app's one runtime: the rack store, the sandbox client that follows it,
// and the agent service, built as layers and torn down together. React owns
// when it starts and stops (see AppProvider), and nothing else.

export class RackStoreService extends Context.Service<
  RackStoreService,
  StoreApi<RackStore>
>()("RackStore") {}

export class Sandbox extends Context.Service<Sandbox, SandboxClient>()(
  "Sandbox",
) {}

export class Agent extends Context.Service<Agent, AgentService>()("Agent") {}

export type AppRuntimeOptions = {
  // The frame stopped answering; whoever owns it should connect again.
  readonly onSandboxLost?: () => void;
  // For tests: how the agent itself is made.
  readonly createAgent?: CreateAgent;
  // Where to record what the store, the sandbox and the agent do (?debug).
  readonly debug?: DebugLog;
};

const StoreLive = Layer.succeed(RackStoreService, rackStore);

// Records every dispatch while the runtime runs, when asked to.
const DebugLive = ({ debug }: AppRuntimeOptions) =>
  debug === undefined
    ? Layer.empty
    : Layer.effectDiscard(
        Effect.acquireRelease(
          Effect.sync(() =>
            onDispatch((dispatched) =>
              record(debug, { at: Date.now(), source: "rack", ...dispatched }),
            ),
          ),
          (unsubscribe) => Effect.sync(unsubscribe),
        ),
      );

const SandboxLive = ({ onSandboxLost, debug }: AppRuntimeOptions) =>
  Layer.effect(
    Sandbox,
    Effect.gen(function* () {
      const store = yield* RackStoreService;
      return yield* makeSandboxClient(
        {
          getState: store.getState,
          subscribe: store.subscribe,
          onWork: onRackWork,
        },
        {
          ...(onSandboxLost === undefined ? {} : { onLost: onSandboxLost }),
          ...(debug === undefined
            ? {}
            : {
                onDebug: (event) =>
                  record(debug, { at: Date.now(), source: "sandbox", event }),
              }),
        },
      );
    }),
  );

const AgentLive = ({ createAgent, debug }: AppRuntimeOptions) =>
  Layer.effect(
    Agent,
    Effect.gen(function* () {
      const store = yield* RackStoreService;
      const sandbox = yield* Sandbox;
      const deps: ActionDeps = {
        store,
        sandbox: () => sandbox,
        status: sandboxStatus.getState,
      };
      return yield* makeAgentService({
        applyAction: (action, signal, turn) =>
          applyAction(deps, action, signal, turn),
        checkAfterTurn: (signal) => checkAfterTurn(deps, signal),
        ...(createAgent === undefined ? {} : { createAgent }),
        ...(debug === undefined
          ? {}
          : {
              onDebug: (event) =>
                record(debug, { at: Date.now(), source: "agent", event }),
            }),
      });
    }),
  );

// Runtimes made and not yet disposed, for checking nothing is left running.
let live = 0;
export const liveRuntimes = () => live;

export type AppRuntime = {
  readonly sandbox: SandboxClient;
  readonly agent: AgentService;
  readonly dispose: () => Promise<void>;
};

export const makeAppRuntime = (options: AppRuntimeOptions = {}): AppRuntime => {
  const layer = AgentLive(options).pipe(
    Layer.provideMerge(SandboxLive(options)),
    Layer.provideMerge(StoreLive),
    Layer.merge(DebugLive(options)),
  );
  const runtime = ManagedRuntime.make(layer);
  const services = runtime.runSync(
    Effect.gen(function* () {
      return { sandbox: yield* Sandbox, agent: yield* Agent };
    }),
  );
  live += 1;
  let disposed = false;
  return {
    ...services,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await runtime.dispose();
      live -= 1;
    },
  };
};
