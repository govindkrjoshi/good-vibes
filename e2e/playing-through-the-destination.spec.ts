import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { blocks, connect } from "./helpers";

// A test cannot listen, so it counts what a note takes instead: every attack
// and release moves an envelope with one of the browser's ramps. Building the
// graph only sets values, so the count moves only while something plays.
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

    // Taps whatever feeds the speakers, to measure what they would play.
    const tapped = window as unknown as { loudest: () => number };
    const taps: AnalyserNode[] = [];
    tapped.loudest = () =>
      Math.max(
        0,
        ...taps.flatMap((tap) => {
          const samples = new Float32Array(tap.fftSize);
          tap.getFloatTimeDomainData(samples);
          return Array.from(samples, Math.abs);
        }),
      );
    const connect = AudioNode.prototype.connect as (
      this: AudioNode,
      ...args: unknown[]
    ) => unknown;
    AudioNode.prototype.connect = function (
      this: AudioNode,
      ...args: unknown[]
    ) {
      if (args[0] instanceof AudioDestinationNode) {
        const tap = this.context.createAnalyser();
        taps.push(tap);
        connect.call(this, tap);
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
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
  await expect(destination.getByRole("heading")).toHaveText("Destination");
  await expect(destination.locator("[data-handleid$=':in']")).toHaveCount(1);
  await expect(destination.locator("[data-handleid$=':out']")).toHaveCount(0);
});

// The frame's audio context starts suspended, until Play, which Chrome warns about.
const audioNotStarted = "The AudioContext was not allowed to start";

async function playRiff(page: Page) {
  await page.keyboard.press("i");
  await page.keyboard.press("d");
  await expect(synth(page)).toHaveCount(1);
  await expect(blocks(page).getByRole("heading")).toHaveText("Destination");
  await connect(
    page,
    synth(page).locator("[data-handleid$=':out']"),
    blocks(page).locator("[data-handleid$=':in']"),
  );
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.getByTestId("run-rack").click();
}

// The counter lives in each frame, and the audio is in the sandbox's.
const sandboxRamps = async (page: Page) => {
  const frame = page.frames().find((held) => held !== page.mainFrame());
  if (frame === undefined) throw new Error("sandbox frame not found");
  return frame.evaluate(
    () => (window as unknown as { rampsScheduled: number }).rampsScheduled,
  );
};

async function expectRampsToKeepMoving(page: Page) {
  await expect(async () => {
    const before = await sandboxRamps(page);
    await page.waitForTimeout(400);
    expect(await sandboxRamps(page)).toBeGreaterThan(before);
  }).toPass();
}

const watchForProblems = (page: Page) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (
      ["warning", "error"].includes(message.type()) &&
      !message.text().includes(audioNotStarted)
    ) {
      problems.push(message.text());
    }
  });
  return problems;
};

test("plays its riff from a synth patched into the destination", async ({
  page,
}) => {
  const problems = watchForProblems(page);

  await playRiff(page);

  // Play starts audio in the background, so the riff takes a moment to begin;
  // once it has, its envelopes keep moving for as long as the rack runs.
  await expectRampsToKeepMoving(page);
  expect(problems).toEqual([]);
});

test("sends real signal to the speakers while playing", async ({ page }) => {
  const frame = page.frames().find((held) => held !== page.mainFrame());
  if (frame === undefined) throw new Error("sandbox frame not found");
  const loudest = () =>
    frame.evaluate(() =>
      (window as unknown as { loudest: () => number }).loudest(),
    );

  await playRiff(page);

  await expect(async () => {
    expect(await loudest()).toBeGreaterThan(0.01);
  }).toPass();
});

test("stops playing when stopped, and plays again", async ({ page }) => {
  await playRiff(page);
  await expectRampsToKeepMoving(page);

  await page.getByTestId("run-rack").click();
  await page.waitForTimeout(200);
  const stopped = await sandboxRamps(page);
  await page.waitForTimeout(600);
  expect(await sandboxRamps(page)).toBe(stopped);

  await page.getByTestId("run-rack").click();
  await expectRampsToKeepMoving(page);
});

test("keeps playing while its params and tempo change", async ({ page }) => {
  const problems = watchForProblems(page);
  await playRiff(page);
  await expectRampsToKeepMoving(page);

  await synth(page).getByRole("slider", { name: "Volume" }).focus();
  await page.keyboard.press("ArrowLeft");
  const bpm = page.locator("#transport-bpm");
  await bpm.fill("90");
  await bpm.press("Enter");

  await expectRampsToKeepMoving(page);
  expect(problems).toEqual([]);
});
