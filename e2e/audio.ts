import { expect, type Frame, type Page } from "@playwright/test";
import { blocks, connect, sandboxFrame } from "./helpers";

// The rack's audio lives in the sandbox frame. This counts, in every frame,
// the envelope ramps notes make, so a test can tell where audio runs and
// whether it is playing.
const counters = ({ strict }: { readonly strict: boolean }) => {
  const counted = window as unknown as {
    rampsScheduled: number;
  };
  counted.rampsScheduled = 0;
  const ramps = AudioParam.prototype as unknown as Record<
    string,
    (this: AudioParam, ...args: unknown[]) => AudioParam
  >;
  for (const name of [
    "setTargetAtTime",
    "linearRampToValueAtTime",
    "exponentialRampToValueAtTime",
  ]) {
    const ramp = ramps[name];
    if (ramp === undefined) continue;
    ramps[name] = function (...args) {
      counted.rampsScheduled += 1;
      return ramp.apply(this, args);
    };
  }

  if (!strict) return;

  // As Safari does: audio only starts from a click in the frame itself, never
  // from one in the app it is embedded in. Chromium counts the app's click as
  // activating the frame too, and starts a context by itself once a node in
  // it plays, so a context that starts any other way is put back to sleep.
  let clickedHere = false;
  let unlocked = false;
  window.addEventListener(
    "click",
    () => {
      clickedHere = true;
      setTimeout(() => (clickedHere = false));
    },
    true,
  );
  const resume = AudioContext.prototype.resume;
  AudioContext.prototype.resume = function () {
    if (!clickedHere && !unlocked) return new Promise<void>(() => undefined);
    unlocked = true;
    return resume.call(this);
  };
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args: ConstructorParameters<typeof AudioContext>) {
      super(...args);
      this.addEventListener("statechange", () => {
        if (this.state === "running" && !unlocked) void this.suspend();
      });
    }
  };
};

export const open = async (page: Page, strict: boolean) => {
  await page.addInitScript(counters, { strict });
  const hydrated = page.waitForEvent(
    "console",
    (message) => message.text() === "Sandbox loaded",
  );
  await page.reload();
  await hydrated;
};

export const read = (target: Page | Frame) =>
  target.evaluate(
    () => (window as unknown as { rampsScheduled: number }).rampsScheduled,
  );

// A synth playing its riff into the destination.
export const buildRiff = async (page: Page) => {
  await page.keyboard.press("i");
  await page.keyboard.press("d");
  await expect(page.getByTestId("rack-node")).toHaveCount(1);
  await connect(
    page,
    page.getByTestId("rack-node").locator("[data-handleid$=':out']"),
    blocks(page).locator("[data-handleid$=':in']"),
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
};

export const expectPlaying = async (page: Page) => {
  const frame = await sandboxFrame(page);
  await expect(async () => {
    const before = await read(frame);
    await page.waitForTimeout(400);
    expect(await read(frame)).toBeGreaterThan(before);
  }).toPass();
};

export const expectSilent = async (page: Page) => {
  const frame = await sandboxFrame(page);
  await expect(async () => {
    const before = await read(frame);
    await page.waitForTimeout(600);
    expect(await read(frame)).toBe(before);
  }).toPass();
};
