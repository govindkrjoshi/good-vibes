import { Context, Effect, Layer, ManagedRuntime } from "effect";
import type { StoreApi } from "zustand";
import { applyAction, checkAfterTurn, type ActionDeps } from "./actions";
import { makeAgentService, type AgentService, type CreateAgent } from "./agent";
import { onRackWork, rackStore, type RackStore } from "./rack";
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
};

const StoreLive = Layer.succeed(RackStoreService, rackStore);

const SandboxLive = ({ onSandboxLost }: AppRuntimeOptions) =>
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
        onSandboxLost === undefined ? {} : { onLost: onSandboxLost },
      );
    }),
  );

const AgentLive = ({ createAgent }: AppRuntimeOptions) =>
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
