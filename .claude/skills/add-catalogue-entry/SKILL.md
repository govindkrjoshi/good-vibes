---
name: add-catalogue-entry
description: Add a new Tone.js element (instrument, source, effect, component, signal, output) to the good-vibes catalogue in app/catalogue/index.ts. Use when asked to "add X to the catalogue", "support Tone.X", "make X available in the rack/agent", or to add params, methods or a default riff to an existing catalogue entry.
---

# Add a catalogue entry

The catalogue (`app/catalogue/index.ts`) is a map of `category → entry → { name, rack: RackTemplate }`.
A template is plain data: it holds the code that builds the Tone.js node, the params the UI and agent can set, the methods they can call, and the events the block plays when it's added. Nothing else needs to know about a specific entry:

- **UI:** `app/components/rack/*` builds the node panel from the template's params and methods. Number params with a `min` and `max` get a slider; params without a `max` get a field only. Groups become collapsible sections. Methods become action forms built from their args.
- **Agent:** `app/actions/index.ts` lists every entry, and its param paths, in `describe`, and `add_block` takes any `category`/`entry`. A new entry is usable by the agent right away.
- **Audio:** `app/rack/renderer.ts` runs `code` in the sandbox frame and then sets each param on the node by walking `path`. It calls methods by name with their args in the order you declare them.

So adding an entry is normally **data plus tests**, with no component or renderer changes. If you find yourself editing the renderer or the UI, stop and tell the user why first.

## 1. Read the real Tone.js API first

Use Tone **15.1.22**, which is installed locally. Don't rely on memory, and fetch the docs only if the local files are unclear:

- `node_modules/tone/build/esm/<area>/<Class>.d.ts`: the option names, which members are `Param`/`Signal` (these can be automated) and which are plain numbers, and the method signatures.
- `node_modules/tone/build/esm/<area>/<Class>.js` → `getDefaults()`: the true default values. Follow `super`/`Monophonic`/`ModulationSynth` up the chain for inherited ones.

Areas include `instrument`, `source/oscillator`, `source`, `effect`, `component/*` and `signal`.

## 2. Write the template

Add a `const <name>Rack: RackTemplate` next to the others and register it in `CATALOGUE`. Model the entry on the existing ones: `amSynthRack` for an instrument, `amOscillatorRack` for a source and `destinationRack` for a sink. The types are in `app/rack/model.ts` (`RackTemplate`, `ParamTemplate`, `MethodTemplate`, `EventTemplate`).

**Identity**
- `id: "catalogue:<category>:<Entry>"`, `name: "<Entry>"`, `type: "leaf"`, `isRoot: false`, `jackIds: []`.
- Category keys in use are `source`, `instruments` and `output`. Reuse one when it fits. A new category key (e.g. `effects`) is fine, but it changes the expected category list in the tests (see step 4).

**`code`**: a *string* holding an expression that evaluates to an Effect. Only `Effect`, `Tone` and `LeafError` are in scope, because it runs in the sandbox:
```ts
code: `Effect.gen(function* () {
  const tone = yield* Tone;
  return new tone.FMSynth();
})`,
```
- Only build the node here; don't pass options. The renderer sets param values afterwards.
- **Sources** (oscillators, noise, players) make no sound until started and have no trigger method, so return `new tone.X().start()`. Leave a short comment saying why, as `amOscillatorRack` does.

**`jacks`**: leave it out to get both in and out jacks. Use `["in"]` for a sink like the destination, or `["out"]` for something that can't take input, if that's clearer.

**`params`**: a `ParamTemplateGroup` made of top-level `params` plus named `groups`, which can nest. Each param is:
- `path`: the property path on the node, e.g. `["envelope", "attack"]`. The param id becomes `<blockId>:param:<path.join(".")>`, so **paths must be unique within the template**, and the agent sees them as `envelope.attack`. Use the record key that matches the last path segment.
- `kind`: one of the following.
  - `"number"`: give `defaultValue`, `min`, `max` (only when there's a real upper bound), `step` and `unit` (`"dB"`, `"cents"`, `"Hz"`, `"s"`).
  - `"select"`: give `options: [{ value }]` and `defaultValue`.
  - `"boolean"`.
  - `"text"`.
- `automation: { methods: ["setValueAtTime", "rampTo", "linearRampToValueAtTime"] }` goes **only on members that are `Param`/`Signal` in the `.d.ts`** (e.g. `volume`, `detune`, `frequency`, `harmonicity`). Plain numbers like envelope times, `portamento` or `Q` on some nodes can't be automated. Add `"exponentialRampToValueAtTime"` only for values that are always positive, such as frequency.
- `defaultValue` must equal Tone's `getDefaults()` value, so that the rendered node matches the panel.
- Group nested members the way the node nests them: `oscillator`, `envelope`, `filter`, `filterEnvelope`, `modulation` and so on. Give each group a human `name`. Any group with number params keyed `attack`, `decay`, `sustain` and `release` gets an ADSR curve drawn in the panel, so keep those keys as they are.
- A param that only exists in some setups, like `oscillator.width` (pulse only), is fine. The renderer skips it when Tone reads it as `undefined`. A path whose *parent* doesn't exist is a render error, though, so check every path.

**`methods`** (optional): `Record<key, { name, method, args }>`.
- `args` must be in **Tone's positional order**, because the renderer calls `node[method](...args)`.
- Arg `kind` can be `"note"`, `"time"`, `"number"`, `"boolean"` or `"text"`. Mark optional args with `optional: true` and give `defaultValue` where Tone has one, e.g. velocity `1`.
- Scheduled events put the clock time in the **last** `time` arg and the step value in the first `note` arg. Durations come before the start time, as in `triggerAttackRelease(note, duration, time, velocity)`.
- Leave out methods that take audio nodes or arrays; the forms can't express them.

**`events`** (optional, for instruments): give it a short default riff so that a newly added block is audibly working. This follows the AMSynth comment, *"A synth that is silent until scheduled is hard to tell from one that is broken"*. `method` is a key of this template's `methods`:
```ts
events: {
  riff: {
    method: "triggerAttackRelease",
    kind: "sequence",
    steps: ["C3", null, "E3", null, "G3", null, "C4", null],
    subdivision: "8n",
    args: { duration: "16n" },
    mute: false,
  },
},
```
Percussive or unpitched instruments (NoiseSynth, MetalSynth) take no note, so use `triggerAttackRelease(duration, time)` and a loop or a sequence of non-null placeholder steps. Check the signature.

**Comments**: match the file. Add one short comment only where a choice isn't obvious (why `.start()`, why a riff, why `jacks`).

## 3. Toolbar wiring (ask first)

`app/components/canvas/chrome.tsx` maps toolbar buttons to entries. `addInstrument` points at `instruments/AMSynth`, and `addSource`, `addEffect` and others still add a bare leaf. Each button adds exactly one entry, so **don't re-point a button without asking the user**. Adding an entry without toolbar wiring is fine, because the agent can still add it.

## 4. Tests

Update the tests that pin the catalogue contents:
- `app/catalogue/index.test.ts`: the `categories()` list and the `subCategories` expectations, when you touch those categories.
- `app/actions/index.test.ts` ("describes an empty rack…"): the `catalogue` array uses `toEqual`, so add the new `{ category, entry, params }` row in catalogue order.

Add a renderer test to `app/rack/renderer.test.ts`. It runs real Tone on an offline context, using the `template()`, `store()`, `makeRuntime()` and `nodeOf()` helpers there. At minimum, show that the entry renders and that **every** param path resolves:
```ts
test("<Entry> renders with every catalogue param applied", async () => {
  const id = defined(store().addTemplate(template("<category>", "<Entry>")), "<Entry>");
  const runtime = await makeRuntime();
  await Effect.runPromise(runtime.render);
  const node = await nodeOf<ToneJs.<Class>>(runtime, id);
  expect(node).toBeInstanceOf(ToneJs.<Class>);
  // e.g. set a non-default value and check it reached the node:
});
```
`nodeOf` throws if the leaf failed, and a bad `path` fails the leaf with `No a.b on node`. Also set one non-default value per group with `setParamValue` and assert it on the node. If you added methods, call one with `runLeafMethod`.

E2E (`e2e/`) is only needed when you wire the entry to a toolbar button. If you do, follow `e2e/playing-an-instrument.spec.ts`.

## 5. Verify

Run `pnpm test`, `pnpm typecheck` and `pnpm lint`. Run `pnpm test:e2e` too if you changed the toolbar. Report the actual results, including any failures that were already there before your change.

## Checklist
- [ ] Defaults, `Param`/`Signal` status and method signatures were read from `node_modules/tone` 15.1.22.
- [ ] `id` is `catalogue:<category>:<Entry>`, and the entry is registered in `CATALOGUE`.
- [ ] `code` is a string Effect that only constructs the node (`.start()` for sources).
- [ ] Param paths are unique and exist on the node; `automation` is only on Param/Signal members; no `max` where there's no real bound.
- [ ] Method args are in Tone's order, with the start time as the last `time` arg.
- [ ] Instruments have a default `events` riff.
- [ ] Catalogue, actions and renderer tests are updated or added; test, typecheck and lint pass.
