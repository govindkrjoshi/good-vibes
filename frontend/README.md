# frontend

React Router frontend for Good Vibes.

## UI components

Uses [shadcn/ui](https://ui.shadcn.com) (Radix primitives, `radix-nova` style, neutral
base colour) on Tailwind v4. Configuration lives in `components.json`.

Add a component — run from this directory so the CLI picks up `components.json`:

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
