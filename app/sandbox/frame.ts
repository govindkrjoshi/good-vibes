import * as Tone from "tone";
import { makeRackHost } from "./host";
import { frameReady, isHostHello } from "./protocol";

// The script the sandbox page runs: it owns the AudioContext and every Tone.js
// object, and builds the rack's graph from what the app sends it. It is
// bundled whole and inlined into the page, since the frame can load nothing.

const start = () => {
  // Without an opaque origin this would run with the app's privileges, which
  // the page has already refused; a later script still runs, so it checks too.
  if (window.origin !== "null") return;

  const ready = frameReady(Math.random().toString(36).slice(2));
  const button = document.getElementById("start-audio");
  const context = Tone.getContext();
  // Audio is only asked for once the app first runs the rack; until then a
  // suspended context is not something to click about.
  let wanted = false;
  const host = makeRackHost(Tone, {
    // A Run in the app is not a gesture in this frame, but browsers that let
    // the app delegate autoplay (allow="autoplay") start audio anyway. Those
    // that do not leave it suspended, and the frame asks for a click.
    startAudio: () => {
      wanted = true;
      void Tone.start();
      setTimeout(report, 250);
    },
  });

  const report = () => {
    if (!wanted) return;
    const state = context.state;
    if (button !== null) button.hidden = state !== "suspended";
    host.report(state === "interrupted" ? "suspended" : state);
  };
  context.on("statechange", report);

  // A click here is a gesture in this frame, which is what audio needs.
  button?.addEventListener("click", () => {
    void Tone.start().then(report);
  });

  // Only the app embedding the frame can be its parent, so it is the only
  // window listened to. It asks whether the frame is up, then hands over its
  // end of a channel, which is all the two use from then on.
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !isHostHello(event.data)) return;

    if (event.data.type === "ping") {
      window.parent.postMessage(ready, "*");
      return;
    }
    const [port] = event.ports;
    if (port === undefined) return;
    host.attach(port);
    report();
  });

  // In case the app was listening before the frame loaded.
  window.parent.postMessage(ready, "*");
};

start();
