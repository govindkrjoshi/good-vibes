# Catalogue plugins

The catalogue is loaded at runtime from plugins (`app/catalogue/registry.ts`).
The built-in Tone.js items are the `tone` plugin. A user or the agent can load
another plugin from JSON with the catalogue slice's `loadPlugin`.

## An item

An item is a plain-data `ItemSpec` (`app/catalogue/spec.ts`) with no ids. It
gets ids when it is placed (`instantiate.ts`), so the same item can be placed
many times and racks keep their own copy.

```json
{
  "type": "leaf",
  "name": "Wobble",
  "category": "effects",
  "description": "A slow filter sweep.",
  "code": "Effect.gen(function* () { const { tone } = yield* RenderContext; return new tone.AutoFilter(0.5).start(); })",
  "params": {
    "params": [
      { "name": "Wet", "kind": "number", "path": ["wet"], "defaultValue": 1, "min": 0, "max": 1, "patchable": true }
    ]
  }
}
```

- `code` is the source of an Effect that builds the Tone.js node. It only
  runs in the sandbox frame, never in the page.
- A param's `path` is where `node.set()` puts its value. A path the node
  doesn't have is reported when the rack is built.
- `patchable: true` on a number param gives it an input jack; a signal
  patched there drives the param in place of its value.
- `jacks` defaults to one input and one output. A jack's `port` reaches a
  member of the node (`{ "member": ["a"] }`) or a numbered input or output
  (`{ "index": 1 }`). Jacks that share a direction each need a `key`.
- `methods` and `events` make an item playable; an event names the Tone
  method it calls.
- `readout` (`level`, `dc`, `spectrum`, `waveform`) draws what the node's
  `getValue()` returns on the rack's panel.

## A plugin

```json
{ "format": 1, "id": "mine", "name": "My sounds", "version": "1", "items": [] }
```

Items are filed under `pluginId/name`, so two plugins can each have a `Bass`.
An item that doesn't decode or doesn't hold together is reported in the
registry's `errors`; the rest still load.

## A built-in item

One file under `app/catalogue/plugins/tone/<category>/`, default-exporting
`defineItem(...)` built with the helpers in `app/catalogue/kit/`. Nothing
else needs editing. `plugins/tone/real-tone.test.ts` builds every item with
real Tone and sets every param, so `pnpm test` catches a wrong path or class.
