# good-vibes

React Router frontend for Good Vibes. A single pnpm package: app code lives in
`app/`, Playwright end-to-end tests in `e2e/`.

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
