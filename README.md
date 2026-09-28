# good-vibes

PNPM monorepo with three workspace packages:

- `backend`
- `frontend`
- `e2e` (Playwright end-to-end tests)

## Commands

```sh
pnpm install
pnpm dev
pnpm build
pnpm --filter backend dev
pnpm --filter frontend dev
```

## End-to-end tests

The `e2e` package runs Playwright against the frontend dev server, which it starts on port 5173 (or reuses if already running).

```sh
pnpm e2e:install   # once: downloads Chromium for Playwright
pnpm test:e2e      # run the suite headless
pnpm --filter e2e test:e2e:ui   # interactive runner
```
