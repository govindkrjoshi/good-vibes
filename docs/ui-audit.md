# UI audit

Audited 2026-10-13 against the dev build, driven with Playwright at 1440,
1024, 768 and 390px wide. Covered the chat, toolbar, rack node, event and
automation editors, help and settings menus, the error and no-key paths,
and keyboard navigation.

The app has a solid base: consistent islands, a toolbar with roving focus,
labelled controls everywhere, a chat that stays out of the way. The problems
are mostly in what the chrome promises versus what it does, and in a few
states nobody has looked at yet. Findings are ordered by severity within
each section.

## Bugs and broken flows

- **Opening "Add event" near the bottom scrolls the whole app off-screen.**
  With the rack node expanded, switching the editor to Part grows the
  popover past the viewport. The document scrolls 333px and the top bar sits
  at y=-333 until the user scrolls back. The popover should flip or cap its
  height instead of extending the page. `app/components/event-editor.tsx`
- **Five of the seven "Add" tools create the wrong thing.** Source, Effect,
  Signal and Event all add a block named "Leaf"; Component adds a "Group".
  Picking "Add effect" yields a card called Leaf with no explanation. Hide
  or disable these until their block types exist.
  `app/components/canvas-chrome.tsx:40`
- **New blocks stack straight down and walk off the canvas.** Each addition
  lands 93px below the last. By the fourth block the newest is below the
  fold and nothing pans to it. Place new blocks in the visible area or fit
  the view after adding. `app/stores/rack.ts`
- **The toolbar is clipped on phones.** At 390px the toolbar is 431px wide.
  The lock button starts at x=-16 and the delete button spills past the
  right edge. Neither is reachable and the strip does not scroll.
  `app/components/rack-toolbar.tsx:57`
- **Run gives no feedback.** The Run button looks identical before and
  after a click. There is no pressed state, no running indicator anywhere,
  and Stop is always enabled. On an empty rack Run does nothing visible.
  `app/components/top-bar.tsx`
- **Undo and Redo are permanently disabled.** The controls render but no
  handler is ever passed, so they are dead chrome in the most prominent
  corner of the canvas. `app/components/viewport-controls.tsx:80`
- **BPM has no upper bound.** Letters and zero are rejected, but 99999 is
  accepted. There is no max and no visible range.
  `app/components/top-bar.tsx`

## User experience

- **The empty canvas offers nothing.** First-time users see a grid and a
  toolbar of icons. The only onboarding is the agent's greeting, which
  depends on a working key and network. Put a short invitation on the
  canvas itself, such as "Add an instrument to start", and remove it once a
  block exists.
- **Chat errors are raw transport dumps.** A bad key shows
  `401: {"message":"No auth credentials found"}` as the first thing in the
  panel, with no plain explanation and no way to fix it from there. Say what
  happened and link to the key dialog. The greeting also fires on every
  load, so a broken key greets the user with an error each time.
  `app/components/chat-panel.tsx`, `app/hooks/useGoodVibesAgent.tsx:247`
- **Closing the chat on a phone is awkward.** It covers most of the screen,
  tapping the exposed strip of canvas does nothing, and there is no scrim.
  The only way out is the toggle in the top bar. `app/routes/home.tsx:35`
- **Nothing tells you about Shift+Enter.** Enter sends, Shift+Enter breaks
  a line, and neither is mentioned anywhere.
- **The event row is hard to read.** The play icon, the unlabelled switch
  (it mutes but reads as "enabled"), the X and the eight steps all sit in
  one row with no grouping. A switch that mutes should look like a mute
  control. `app/components/event-editor.tsx:489`
- **"Fit view", "Zoom to 100%" and "Add group" use near-identical
  dashed-corner icons.** In the canvas menu the two zoom items are visually
  interchangeable, and the Group tool in the toolbar looks like Fit view.
  `app/components/canvas-menu.tsx`, `app/components/rack-toolbar.tsx`
- **The profile menu is a dead end.** "Not signed in" with a disabled
  "Sign in" item is chrome for a feature that does not exist. Drop it until
  it does. `app/components/top-bar.tsx`
- **The help popover lists only the letter shortcuts.** It says nothing
  about panning, zooming, selecting, connecting blocks, or the chat's Enter
  behaviour. `app/components/help-button.tsx`

## Interface and accessibility

- **Dark mode is not honoured.** The CSS defines a full dark palette but the
  variant is class-based and nothing sets the class, so a dark-scheme
  browser gets the light theme. `app/app.css:6`
- **Tiny targets throughout the rack node.** Slider thumbs are 10px,
  connection handles 6px, the mute switch 24x14, and the step buttons 20px
  wide. All are under the 24px minimum and painful with a trackpad, let
  alone touch. `app/components/ui/slider.tsx`, `app/components/event-editor.tsx`
- **The shortcut hints on toolbar buttons are 9px muted grey.** They are
  decorative at that size. Make them legible or move them into the tooltip,
  which already exists. `app/components/ui/toolbar.tsx`
- **Keyboard focus is faint.** The focus ring is a 3px halo at 50% opacity
  in light grey. Tabbing through the toolbar it is barely distinguishable
  from the hover background. `app/components/ui/button.tsx`
- **Chat muted text sits on the off-white sidebar.** "Thinking…" and the
  placeholder are at roughly 4.4:1 against the sidebar colour, just under
  AA for small text.
- **The rack node is a very long form.** Fully expanded it is over 1000px
  tall, and at 50% zoom nothing inside is readable. Consider a compact mode
  when zoomed out. `app/components/rack-node.tsx`
- **The scroll-to-bottom button overlaps message text.** In a full chat it
  floats directly over the last bubble with no backdrop.
  `app/components/ui/message-scroller.tsx`
- **The envelope curve bleeds to the card edge** on the right while the
  left has padding, so the panel reads as misaligned.
  `app/components/envelope-curve.tsx`
- **No page-level heading.** Block titles are h2s but there is no h1, and
  the aria-labelled regions are the only structure a screen reader gets.
- **The mobile top bar loses the BPM label.** The field shows a bare "120"
  with no visible cue to what it is. `app/components/top-bar.tsx`

## Visual direction

The app is currently the shadcn neutral default: white, grey borders, one
radius everywhere, Geist. For a music instrument that is a missed
opportunity rather than an error. The one place to spend some boldness is
the rack node, since it is what people stare at and play. A distinct
treatment there, such as a tinted header per block category or a readout
style for values, would do more than any amount of chrome polish. The
toolbar and chat can stay quiet.

## Suggested fix order

1. Popover scroll in the event editor.
2. Phone toolbar overflow.
3. Block placement after adding.
4. Placeholder Add tools (hide or disable).
5. Run and Stop state feedback.
6. Chat error copy and recovery.
7. Rack node target sizes.
8. Everything else above, roughly in listed order.
