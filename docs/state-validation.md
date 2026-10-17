# State validation

The rack slice (`app/stores/rack.ts`) does not validate what its actions are
given. It writes values, events, automations and the transport as they arrive.

The plan is to describe the whole app state as an Effect schema and validate
against that, instead of hand-written checks in each action.

## Direction

- `app/rack/model.ts` already defines schemas for the parts: `RackSchema`,
  `JackSchema`, `PatchSchema`, `ParamSchema`, `ParamGroupSchema`,
  `MethodSchema`, `RackEventSchema`, `TransportSchema`. A `RackStateSchema`
  would put them together as the store's state, so `RackState` comes from the
  schema rather than being written by hand.
- Checks that span entities (a value fits its param, an event fits its
  method) are refinements on the state schema, not on the single entity.
- Where it runs (in each action, in a middleware around `set`, or on a
  subscriber that reports into `errors`) is still open.

## Checks to carry over

These were in the old store (`app/rack/store.ts`) and are not done anywhere
in the new slice:

- **Param values** (`acceptValue`): the value's type matches the param's
  kind; numbers are finite and clamped to `min`/`max`; a select value is one
  of its options.
- **Automations** (`addAutomation`): only on number params; the method is in
  the param's `automation.methods`; the value is finite; `time` and
  `rampTime` are valid Tone times.
- **Times** (`isTime`): seconds, a musical length (`4n`, `8t`, `1m`, ...) or
  `bars:beats:sixteenths`, optionally after a `+`. A bad time only throws
  when Tone fires it inside a transport callback, where nothing can catch it,
  so it has to be rejected up front.
- **Events** (`acceptEvent`):
  - the method has a time arg; kinds other than `event` need a note arg too;
  - every required arg that isn't the time or the stepped note is fixed in
    `args`;
  - `probability` is in 0..1 and `humanize` is a valid time;
  - a sequence has steps and a valid subdivision; a pattern has values and a
    valid interval; a part's steps all have valid times; a looping `event`
    has a valid `loopEnd`, and `loop` is `true` or a positive integer.
- **Sequence steps** (`setEventSteps`): at least one step.
- **Transport** (`setTransport`): `bpm` is finite and greater than 0.
