# good-vibes

React Router frontend for Good Vibes. A single pnpm package: app code lives in
`app/`, Playwright end-to-end tests in `e2e/`.

## Layout

`app/` is split into headless modules and the UI that fronts them.

```
app/
  rack/         the rack model, its store, and the Tone.js renderer
  catalogue/    templates for the blocks a user can add
  canvas/       rack → React Flow graph projection and layout
  agent/        the chat session, its key handling, and the agent itself
  actions/      applies the changes the agent asks for to the rack
  sandbox/      the sandboxed frame the audio runs in, and how the app talks to it
  pages/        one directory per route; composition only
  components/   React components, grouped by the module they front
  hooks/        thin React bindings, such as useRack over the rack store
  testing/      helpers for tests only
```

Modules hold logic only: no React, no JSX, no DOM, and no imports from
`components`, `hooks` or `pages`. Modules import each other in one direction:
`catalogue` and `canvas` use `rack`; `actions` uses `agent`, `rack`, `sandbox` and
`catalogue`; `sandbox` uses `rack`; `agent` stands alone.
Components import modules, `components/ui` and `hooks`. Pages import anything;
nothing imports from `pages`. `.oxlintrc.json` enforces these boundaries, so
`pnpm lint` fails on a crossing.

## Commands

```sh
pnpm install
pnpm dev         # dev server on http://localhost:5173
pnpm build
pnpm start       # serve the production build
pnpm test        # Vitest unit tests
pnpm typecheck
pnpm lint
```

## Agent

The chat panel on the home page talks to an agent (`app/agent/`, built on
`@earendil-works/pi-agent-core`). The agent runs in the browser and calls
OpenRouter directly, using the first key it finds:

1. **Dev server only:** `OPENROUTER_API_KEY` from the shell or a `.env` file.
   `pnpm dev` hands it to the browser for testing.
2. A key the user saved earlier, in local storage.
3. Otherwise it asks the user for one and saves it to local storage.

```sh
OPENROUTER_API_KEY=sk-or-... pnpm dev
```

Production builds never embed a key, even when `OPENROUTER_API_KEY` is set
while building, so users always bring their own.

The agent can change the rack, but never touches it directly. Its one tool
takes a list of `RackAction`s (the schema in `app/agent/rack-action.ts` is
the source of truth). The agent service (`app/agent/service.ts`) hands the agent a function from
`app/actions/` that applies one: it works out from the rack alone the
messages the action comes to, dispatches them all or nothing, marked as the
agent's, and answers with an `ActionResult`. A refused action stops the rest
of the list. Each action also goes out on the agent's message stream as it is
asked for and again once applied; those messages are what the chat shows as
the agent works.

A `check_errors` action waits for the sandbox to carry out every change made
before it, then reports what failed, grouped by the block at its root and
with who last changed it. A `retry` action builds a block, patch or event
again as it is. The agent is told to end a list that changes the rack with a
check.

The service runs one prompt at a time; a prompt sent while the agent is busy
waits its turn. When a turn ends, the service checks the rack, and if
anything failed, whoever made it, it asks the agent to fix it in another turn
before any prompt waiting. It stops after three tries, as soon as a try
changes nothing about the errors, and never after Stop or a failed reply. The
chat is a store the service feeds through a pure reducer (`app/agent/chat.ts`).

The model chooses the id of each block it adds, so one list can add a block
and then patch it or set its params (`<block id>:param:<name>`) by that id.
Audio can only start from a user gesture, so the agent cannot run the rack:
it asks the user to press Run.

## Sandbox

All audio runs in a sandboxed iframe (`/sandbox.html`), never in the app.
Leaf code (the Effect that builds a block's Tone.js node) is source text in the
rack, and the frame is the only place it is evaluated. The frame has an opaque
origin (`sandbox="allow-scripts"`, no `allow-same-origin`) and a CSP that
reaches no network. It may run inline scripts and `eval`, plus the blobs Tone.js
makes for itself: its clock's worker and the AudioWorklet modules some nodes
need.

- **The app** owns the rack: the store in `app/rack/store.ts` holds it and
  knows nothing about audio. Every change is a message reduced by
  `app/rack/reduce.ts`. The sandbox client (`app/sandbox/client.ts`, run by
  `SandboxProvider`) follows the store and drives the ledger
  (`app/sandbox/ledger.ts`), a pure state machine that decides what the frame is
  sent and keeps what came of it. One batch is in flight at a time: the rack's
  changes since the last batch, then the commands `app/sandbox/reconcile.ts`
  works out to bring the frame up to date, then any Run, Stop or Play. What
  failed, and whether the frame is answering, is in `sandboxStatus`
  (`app/sandbox/status.ts`), which the nodes and the top bar show.
- **The frame** owns the AudioContext and every Tone.js object.
  `app/sandbox/frame.ts` is its script; `app/sandbox/host.ts` keeps a copy of
  the rack, runs each batch's commands in order through the renderer
  (`app/rack/renderer.ts`), and answers with what each did to each block,
  patch and event. A new port is a fresh start: the host throws its graph away
  and the app sends the whole rack again.
- **Between them** (`app/sandbox/protocol.ts`): the frame says it is ready, the
  app hands it one end of a `MessageChannel`, and they only talk over that port
  from then on. Every message is checked against a schema on arrival, in both
  directions.

The frame's script is bundled, with Tone.js, into one classic script by the
Vite plugin in `sandbox-bundle.ts`, and inlined into the page.

Audio can only start from a user gesture, and a Run in the app is not one in the
frame. Chromium lets the app delegate it (`allow="autoplay"`), so Run starts
audio there. Where the browser will not, the frame shows itself with a
"Click to start audio" button, since a click inside the frame does count.

## End-to-end tests

Playwright runs against the dev server, which it starts on port 5173 (or reuses if already running).

```sh
pnpm e2e:install   # once: downloads Chromium for Playwright
pnpm test:e2e      # run the suite headless
pnpm test:e2e:ui   # interactive runner
```

## UI components

Uses [shadcn/ui](https://ui.shadcn.com) (Radix primitives, `radix-nova` style, neutral
base colour) on Tailwind v4. Configuration lives in `components.json`.

Add a component — run from the repo root so the CLI picks up `components.json`:

```sh
pnpm dlx shadcn@latest add <component>
```

Components land in `app/components/ui/` and are ours to edit. Theme tokens
(`--background`, `--primary`, …) live in `app/app.css`.

### Local deviations from upstream

Re-running `shadcn add` for these overwrites the file — re-apply afterwards:

- `card.tsx` — `CardTitle` renders a heading (`h3` by default, level set via
  `as`) instead of upstream's `div`, so card titles land in the document
  outline and are reachable by the `heading` role.
