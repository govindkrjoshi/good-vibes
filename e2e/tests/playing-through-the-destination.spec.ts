import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { blocks, connect } from "./helpers";

// A test cannot listen, so it counts what making a sound takes instead: every
// oscillator Tone starts goes through the browser's `start`.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const counted = window as unknown as { sourcesStarted: number };
    counted.sourcesStarted = 0;
    const start = AudioScheduledSourceNode.prototype.start;
    AudioScheduledSourceNode.prototype.start = function (...args) {
      counted.sourcesStarted += 1;
      return start.apply(this, args);
    };
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

test("plays a note from a synth patched into the destination", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      warnings.push(message.text());
    }
  });
  const sourcesStarted = () =>
    page.evaluate(
      () => (window as unknown as { sourcesStarted: number }).sourcesStarted,
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
  const beforeNote = await sourcesStarted();

  // Run starts audio in the background, so a note triggered straight away can
  // land before the graph is built; keep triggering until one is heard.
  await expect(async () => {
    await synth(page)
      .getByTestId("method-trigger")
      .filter({ hasText: "Trigger Attack Release" })
      .click();
    const form = page.getByRole("dialog", { name: "Trigger Attack Release" });
    await form.getByRole("textbox", { name: "Note" }).fill("C4");
    await form.getByRole("textbox", { name: "Duration" }).fill("8n");
    await form.getByRole("button", { name: "Trigger Attack Release" }).click();

    expect(await sourcesStarted()).toBeGreaterThan(beforeNote);
  }).toPass();
  expect(warnings).toEqual([]);
});
