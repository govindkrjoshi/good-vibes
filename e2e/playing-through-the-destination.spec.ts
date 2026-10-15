import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { blocks, connect, sandboxFrame } from "./helpers";

// A test cannot listen, so it counts what a note takes instead: every attack
// and release moves an envelope with one of the browser's ramps. Building the
// graph only sets values, so the count moves only while something plays.
// Audio runs in the sandbox frame, and the script runs in every frame, so the
// count that moves is the frame's.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const counted = window as unknown as { rampsScheduled: number };
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
  });
  // The fixture already loaded the page, before the counter was in place.
  const hydrated = page.waitForEvent(
    "console",
    (message) => message.text() === "Sandbox loaded",
  );
  await page.reload();
  await hydrated;
});

const synth = (page: Page) => page.getByTestId("rack-node");

test("adds a destination that only takes input", async ({ page }) => {
  await page.getByTestId("add-destination").click();

  const destination = blocks(page);
  await expect(destination).toHaveText("Destination");
  await expect(destination.locator("[data-handleid$=':in']")).toHaveCount(1);
  await expect(destination.locator("[data-handleid$=':out']")).toHaveCount(0);
});

test("plays its riff from a synth patched into the destination", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      warnings.push(message.text());
    }
  });
  const frame = await sandboxFrame(page);
  const rampsScheduled = () =>
    frame.evaluate(
      () => (window as unknown as { rampsScheduled: number }).rampsScheduled,
    );
  const appRamps = () =>
    page.evaluate(
      () => (window as unknown as { rampsScheduled: number }).rampsScheduled,
    );

  await page.keyboard.press("i");
  await page.keyboard.press("d");
  await expect(synth(page)).toHaveCount(1);
  await expect(blocks(page)).toHaveText("Destination");
  await connect(
    page,
    synth(page).locator("[data-handleid$=':out']"),
    blocks(page).locator("[data-handleid$=':in']"),
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page.getByTestId("run-rack").click();

  // Run starts audio in the background, so the riff takes a moment to begin;
  // once it has, its envelopes keep moving for as long as the rack runs.
  await expect(async () => {
    const before = await rampsScheduled();
    await page.waitForTimeout(400);
    expect(await rampsScheduled()).toBeGreaterThan(before);
  }).toPass();
  expect(warnings).toEqual([]);
  // The app itself builds no audio.
  expect(await appRamps()).toBe(0);
});
