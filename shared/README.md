# shared

Library code imported by both `frontend` and `backend`:

- `shared/rack` — the rack data model (blocks, jacks, params, patches, events)
  and its Effect schemas.
- `shared/audio-renderer` — turns a rack into a live Tone.js graph.

The package ships TypeScript source with no build step; consumers compile it
themselves (Vite in the frontend, `tsx` in the backend).
