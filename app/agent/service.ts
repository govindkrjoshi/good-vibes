import { Data, Deferred, Effect, Fiber, Queue, Scope, Stream } from "effect";
import { createStore, type StoreApi } from "zustand";
import type { GoodVibesAgent } from "./agent";
import {
  initialChatState,
  reduceChat,
  type ChatEvent,
  type ChatState,
} from "./chat";
import { knownApiKey, storeApiKey } from "./key";
import type { ApplyAction } from "./tools";
import type { ActionResult, ApiKey, RackAction } from "./types";

// Runs the conversation: one agent for as long as the service lives, fed one
// prompt at a time from a queue, with the chat as a store anyone can read.
//
// Each user prompt starts a chain of turns. When a turn ends normally, the
// service asks whether the rack has errors; if it has, it asks the agent to
// fix them in another turn of the same chain, before any prompt still
// waiting. It stops after `maxFixups` tries, as soon as a try changes nothing
// about the errors, and never after Cancel or a reply that failed.
//
// Cancel interrupts the chain that is running, clears the queue and answers
// a pending key request; the service keeps running for the next prompt.

// One run of the agent, and the user prompt its chain started from.
export type Turn = {
  readonly turnId: string;
  readonly chainId: string;
};

// What the rack looks like after a turn, from whoever knows the sandbox.
export type FixupCheck =
  | { readonly _tag: "Clean" }
  // The check could not finish, and says why.
  | { readonly _tag: "Unchecked"; readonly text: string }
  | {
      readonly _tag: "Errors";
      readonly count: number;
      // Tells one round's errors from the next's: the same fingerprint means
      // the try changed nothing about them.
      readonly fingerprint: string;
      // What to ask the agent.
      readonly prompt: string;
    };

export type CreateAgent = (
  apiKey: ApiKey,
  apply: ApplyAction,
) => Effect.Effect<GoodVibesAgent, never, Scope.Scope>;

export type AgentServiceOptions = {
  // Applies one action for the turn that asked for it.
  readonly applyAction: (
    action: RackAction,
    signal: AbortSignal | undefined,
    turn: Turn | undefined,
  ) => Promise<ActionResult> | ActionResult;
  // Asked after each turn that ends normally. Without it, there are no
  // fix-ups.
  readonly checkAfterTurn?: (signal: AbortSignal) => Promise<FixupCheck>;
  // How the agent is made. By default the agent module is loaded on first
  // use, so the model runtime stays out of the initial bundle.
  readonly createAgent?: CreateAgent;
  readonly maxFixups?: number;
};

export type AgentService = {
  readonly chat: StoreApi<ChatState>;
  // Runs now, or once the prompts before it have.
  readonly prompt: (text: string) => void;
  readonly cancel: () => void;
  // Answers the request for a key, and keeps the key.
  readonly submitKey: (key: string) => void;
  readonly declineKey: () => void;
  // Remembers a key given in settings, for this page load and in storage
  // when storage allows. The running agent reads it on its next request.
  readonly setKey: (key: string) => void;
};

class NoKey extends Data.TaggedError("NoKey")<{ readonly message: string }> {}

let agentModule: Promise<typeof import("./agent")> | undefined;

const loadAgent: CreateAgent = (apiKey, apply) =>
  Effect.promise(() => (agentModule ??= import("./agent"))).pipe(
    Effect.flatMap(({ createGoodVibesAgent }) =>
      createGoodVibesAgent(apiKey, apply),
    ),
  );

export const makeAgentService = ({
  applyAction,
  checkAfterTurn,
  createAgent = loadAgent,
  maxFixups = 3,
}: AgentServiceOptions): Effect.Effect<AgentService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const chat = createStore<ChatState>()(() => initialChatState);
    const emit = (event: ChatEvent) =>
      chat.setState(reduceChat(chat.getState(), event), true);

    // Kept for this page load in case local storage refuses to save it.
    let enteredKey: string | undefined;
    const currentKey = () => enteredKey ?? knownApiKey();
    const setKey = (key: string) => {
      enteredKey = key;
      storeApiKey(key);
    };

    // The open request for a key, while the user is asked. Prompts that need
    // a key while one is open share it.
    let keyRequest: Deferred.Deferred<string, NoKey> | undefined;
    const key: Effect.Effect<string, NoKey> = Effect.suspend(() => {
      const known = currentKey();
      if (known !== undefined) return Effect.succeed(known);
      const asked = keyRequest ?? Deferred.makeUnsafe<string, NoKey>();
      if (keyRequest === undefined) {
        keyRequest = asked;
        emit({ _tag: "KeyNeeded", needed: true });
      }
      return Deferred.await(asked).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (keyRequest === asked) keyRequest = undefined;
            emit({ _tag: "KeyNeeded", needed: false });
          }),
        ),
      );
    });
    const answerKey = (answer: Effect.Effect<string, NoKey>) => {
      const asked = keyRequest;
      keyRequest = undefined;
      if (asked !== undefined) Deferred.doneUnsafe(asked, answer);
    };

    // The turn running now. What the agent says outside a turn, like the end
    // of a reply that was cancelled, is not shown.
    let active: Turn | undefined;

    // Made on the first prompt, once there is a key. Its listener starts
    // before the agent is handed out, so no reply is missed.
    let agent: GoodVibesAgent | undefined;
    const getAgent: Effect.Effect<GoodVibesAgent, NoKey> = Effect.suspend(() =>
      agent !== undefined
        ? Effect.succeed(agent)
        : key.pipe(
            Effect.flatMap(() =>
              Effect.gen(function* () {
                const made = yield* createAgent(
                  () => currentKey() ?? "",
                  (action, signal) => applyAction(action, signal, active),
                );
                yield* Stream.runForEach(made.messages, (said) =>
                  Effect.sync(() => {
                    if (active !== undefined) emit({ _tag: "AgentSaid", said });
                  }),
                ).pipe(Effect.forkIn(scope, { startImmediately: true }));
                agent = made;
                return made;
              }).pipe(Scope.provide(scope)),
            ),
          ),
    );

    // One turn: whether it ended normally.
    const runTurn = (turn: Turn, text: string): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        const ready = yield* getAgent;
        active = turn;
        yield* ready.prompt(text);
        return true;
      }).pipe(
        Effect.catchTags({
          NoKey: (error) =>
            Effect.sync(() => {
              emit({
                _tag: "ReplyFailed",
                turnId: turn.turnId,
                error: error.message,
              });
              return false;
            }),
          PromptError: (error) =>
            Effect.sync(() => {
              emit({
                _tag: "ReplyFailed",
                turnId: turn.turnId,
                error: error.message,
              });
              return false;
            }),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (active === turn) active = undefined;
          }),
        ),
      );

    const check = (): Effect.Effect<FixupCheck | undefined> =>
      checkAfterTurn === undefined
        ? Effect.succeed(undefined)
        : Effect.tryPromise({
            try: (signal) => checkAfterTurn(signal),
            catch: (cause) => String(cause),
          }).pipe(
            Effect.catch((text) =>
              Effect.succeed<FixupCheck>({ _tag: "Unchecked", text }),
            ),
          );

    // A user prompt, then fix-ups while the rack has errors.
    const runChain = (chainId: string, text: string) =>
      Effect.gen(function* () {
        emit({ _tag: "Prompted", turnId: chainId, text });
        if (!(yield* runTurn({ turnId: chainId, chainId }, text))) return;

        let previous: string | undefined;
        for (let round = 1; ; round += 1) {
          const found = yield* check();
          if (found === undefined || found._tag === "Clean") return;
          const notice = `notice-${chainId}-${round}`;
          if (found._tag === "Unchecked") {
            emit({
              _tag: "Noticed",
              id: notice,
              text: `Could not check the rack for errors: ${found.text}`,
            });
            return;
          }
          const errors = `${found.count} ${found.count === 1 ? "error" : "errors"}`;
          if (found.fingerprint === previous) {
            emit({
              _tag: "Noticed",
              id: notice,
              text: `The last fix changed nothing about the ${errors}, so the agent has stopped trying.`,
            });
            return;
          }
          if (round > maxFixups) {
            emit({
              _tag: "Noticed",
              id: notice,
              text: `${errors} still left after ${maxFixups} tries.`,
            });
            return;
          }
          previous = found.fingerprint;
          emit({
            _tag: "Noticed",
            id: notice,
            text: `Found ${errors}; asking the agent to fix ${found.count === 1 ? "it" : "them"}.`,
          });
          const turn = { turnId: `${chainId}-fix-${round}`, chainId };
          if (!(yield* runTurn(turn, found.prompt))) return;
        }
      });

    // Prompts wait here, in order. The chain running takes none until it is
    // done, fix-ups included.
    const waiting = yield* Effect.acquireRelease(
      Queue.unbounded<{ readonly chainId: string; readonly text: string }>(),
      Queue.shutdown,
    );
    let chains = 0;
    let running: Fiber.Fiber<void> | undefined;
    const working = () =>
      emit({
        _tag: "Working",
        busy: running !== undefined || Queue.sizeUnsafe(waiting) > 0,
        queued: Queue.sizeUnsafe(waiting),
      });

    yield* Effect.gen(function* () {
      const next = yield* Queue.take(waiting);
      running = yield* Effect.forkChild(runChain(next.chainId, next.text), {
        startImmediately: true,
      });
      working();
      yield* Fiber.await(running);
      running = undefined;
      working();
    }).pipe(Effect.forever, Effect.forkScoped);

    return {
      chat,

      prompt: (text) => {
        chains += 1;
        Queue.offerUnsafe(waiting, { chainId: `chain-${chains}`, text });
        working();
      },

      cancel: () => {
        Effect.runSync(Queue.clear(waiting));
        answerKey(
          Effect.fail(new NoKey({ message: "Stopped before a key was given" })),
        );
        const chain = running;
        if (chain !== undefined) Effect.runFork(Fiber.interrupt(chain));
        working();
      },

      submitKey: (given) => {
        setKey(given);
        answerKey(Effect.succeed(given));
      },

      declineKey: () =>
        answerKey(
          Effect.fail(
            new NoKey({ message: "No OpenRouter API key was given" }),
          ),
        ),

      setKey,
    };
  });
