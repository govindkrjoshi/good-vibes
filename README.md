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
  sandbox/      the sandboxed page and its CSP
  pages/        one directory per route; composition only
  components/   React components, grouped by the module they front
  hooks/        thin React bindings, such as useRack over the rack store
```

Modules hold logic only: no React, no JSX, no DOM, and no imports from
`components`, `hooks` or `pages`. Modules import each other in one direction:
`catalogue` and `canvas` use `rack`; `agent` uses `rack`, `catalogue`,
`demos` and the store's types; `sandbox` stands alone.
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
`@earendil-works/pi-agent-core`). It reads the rack and the catalogue and
changes the rack with tools, one for each thing a user can do by hand, and
can write a rack of its own from Tone.js code when the catalogue has nothing
that fits; see `docs/agent-tools.md`. The agent runs in the browser and calls
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
