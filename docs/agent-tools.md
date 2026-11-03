# Agent tools

The chat agent (`app/agent/`) reads the rack and changes it through tools.
Each tool calls one action on the rack slice (`app/stores/rack.ts`), the same
action the canvas calls when the user does the same thing by hand, so the
agent can make exactly the changes a user can and no others.

## Wiring

- `createSession({ askForKey, store })` hands the zustand store to the agent.
  `createGoodVibesAgent(apiKey, store)` builds the tools over it with
  `createRackTools` (`app/agent/tools/`). The agent module stays headless:
  it takes the store's type and nothing from React.
- Tool calls in one reply run in order (`toolExecution: "sequential"`), so
  "add, then connect" works in a single turn.
- A tool's result is text. Its first line is what the chat shows as a tool
  row; the row opens to the call's arguments and the whole result, and a
  failure shows the whole message in view. An id the result writes in
  brackets (`[bass]`) is shown as a chip; a rack's chip finds it on the
  canvas.
- The model's thinking is never shown. Instead it has `brief`
  (`app/agent/tools/brief.ts`): one sentence on what it is about to do,
  which changes nothing. The system prompt asks for one before each step, in
  the same reply as the step's tool calls, so it costs no extra turn. The
  chat shows the sentence as the heading of the run of tool rows that
  follow it (`app/components/chat/tool-run.tsx`).

## Reading

| Tool | What it returns |
| --- | --- |
| `read_rack` | Every rack nested under its tree with its jack ids, every patch, the transport and any errors. With `rackId`: that rack's jacks, params with values, methods, events and automations. `withCode` adds a leaf's code. |
| `read_catalogue` | Items as `key — description`, filtered by `query` words and `category`. With `key`: the item in full, with param paths, jacks and methods; `withCode` adds its code as a model to write from. |

Ids are stable and derivable: a rack's jacks are `rack:in`, `rack:out`,
`rack:in:key` or `rack:out:key`; a patchable param's jack is `rack:mod:path`;
params are `rack:param:path`; methods are `rack:method:name`.

## Editing

| Tool | Store action |
| --- | --- |
| `add_rack` | `addRackFromCatalogue`, then `setParamValue` for any `values` given by path |
| `create_rack` | `addItem` with a spec the agent wrote |
| `update_rack` | `replaceItem` |
| `add_group` | `addRack(newTree)`, then `addJack` for each named jack |
| `move_rack` | `moveRack` |
| `remove_racks` | `removeRacks` |
| `clear_rack` | `clear` |
| `load_demo` | `load` with a demo from `app/demos` |
| `add_jack`, `remove_jack` | `addJack`, `removeJack` |
| `connect`, `disconnect` | `connectJacks`, `removePatches` |
| `set_params` | `setParamValue` |
| `add_automation`, `remove_automation` | `addAutomation`, `removeAutomation` |
| `add_event`, `update_event`, `set_event_steps`, `remove_event` | the four event actions |
| `set_transport` | `setTransport` |

The agent picks rack ids (`bass`, `pad-filter`); one is made from the item's
name when it doesn't. Where racks go on the canvas isn't the agent's
concern: the canvas lays itself out whenever the racks or their cables
change, whoever changed them (`AutoLayout` in `viewport.tsx`).

## Checking before the store

The store writes what it is given (see `state-validation.md`), so the tools
check first and change nothing when anything is wrong:

- `app/rack/validate.ts`: a value fits its param's kind, range and options;
  an automation is on a number param with that method and valid times; an
  event's method can be scheduled, its fixed args are the method's and fit,
  and its own settings hold up; steps and tempo.
- `app/rack/time.ts`: what Tone accepts as a time.
- A spec for `create_rack` or `update_rack` goes through the catalogue's own
  `decodeItem` and `itemProblems`, so the same checks apply as to a plugin.
  The code is never evaluated in the page.

## Failures and late errors

Store actions report a failure by adding to `rack.errors` rather than
throwing. Each tool runs its action through an `ErrorWatch`
(`app/agent/tools/tool.ts`): if the list grew, the tool fails with those
messages.

What the sandbox finds (a param path the node lacks, code that fails) arrives
after the tool has returned. The agent watches the same list: anything new is
sent to the model as a user message, after the current turn if it is still
working, or ahead of the next prompt if it has stopped. `read_rack` lists the
latest errors too.

## Writing a rack from code

`create_rack` takes an item spec inline, the same plain data a catalogue
plugin holds (`catalogue-plugins.md`), with `category` defaulting to
`components`. The code contract, repeated in the tool's description and the
system prompt:

- The code is the source of one expression that evaluates to an Effect
  yielding a Tone.js node. It sees only `Effect`, `RenderContext` and
  `LeafError`, and only ever runs in the sandbox.
- It builds the node only. Params are set afterwards with `node.set()` along
  each param's path, so each path must be one the node accepts.
- A source has to be started. A jack with no port is the node itself.
- To fail on purpose: `yield* Effect.fail(new LeafError({ message }))`.

`update_rack` makes a leaf over from a new spec, keeping its id, its place,
the values of params it still has, patches to jacks it still has, and events
added since whose method it still has. The spec's own events are replaced.
A rack made this way has no `item`; one placed from the catalogue remembers
its key on the rack.

## Keeping the conversation

The session (`app/agent/session.ts`) keeps both sides of the conversation
in local storage under `good-vibes:chat` (`app/agent/history.ts`): the
messages the chat shows and the model's own transcript, without the system
prompt. Both are saved once the agent is quiet after each prompt, and a
reload hands the transcript to the new agent as its `history`, so the model
remembers what the user can see. A prompt that got no reply, or a reply
that was stopped or failed, is left out of the transcript so it is not
resumed half-way.

The rack itself is not kept, so with the first prompt after a reload the
agent is told the page reloaded and shown the rack as it is now
(`reloadNote` in `agent.ts`). "New conversation" in the chat's header
resets the agent and clears the storage.

Failed requests are put in plain words by `app/agent/explain.ts`; when a
new key is the fix, the chat offers the key dialog beside the message.

## Tests

- `app/agent/tools/tools.test.ts` runs every tool against the real store.
- `app/agent/tools/real-tone.test.ts` builds an agent-written spec with real
  Tone and checks a wrong path and failing code are reported by name.
- `app/agent/agent.test.ts` scripts replies with pi-ai's faux provider to
  run the loop, the tool rows, `brief`, a resumed conversation and the
  late-error path without the network.
- `app/agent/session.test.ts` and `app/agent/history.test.ts` cover what is
  kept across a reload and what is left out.
- `e2e/agent-edits-the-rack.spec.ts` scripts a tool-calling reply through the
  fake OpenRouter and checks the racks appear on the canvas.
