import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { blockAt, boxOf, drag } from "./helpers";

const instrument = (page: Page) => page.getByTestId("rack-node");

async function addSynth(page: Page) {
  await page.getByTestId("add-instrument").click();
  await expect(instrument(page)).toHaveCount(1);
  return instrument(page);
}

// A section's trigger also reads out its summary ("Oscillator sine"), so it is
// found by the name inside it, not by its whole accessible name. "Modulation"
// is a prefix of "Modulation Envelope", which rules out a name regex.
const sectionTrigger = (panel: Locator, name: string) =>
  panel
    .locator("[data-slot=collapsible-trigger]")
    .filter({ has: panel.page().getByText(name, { exact: true }) });

// A collapsible section has no landmark of its own, so it is scoped to the
// element that holds both its trigger and its panel.
const section = (panel: Locator, name: string) =>
  sectionTrigger(panel, name).locator("..");

async function openSection(panel: Locator, name: string) {
  const trigger = sectionTrigger(panel, name);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return section(panel, name);
}

const readout = (scope: Locator, name: string) =>
  scope.getByRole("textbox", { name, exact: true });

async function typeValue(scope: Locator, name: string, value: string) {
  const field = readout(scope, name);
  await field.fill(value);
  await field.press("Enter");
}

test("adds AMSynth as a panel of its params and actions", async ({ page }) => {
  const panel = await addSynth(page);

  await expect(panel.getByRole("heading", { name: "AMSynth" })).toBeVisible();
  for (const name of ["Volume", "Detune", "Portamento", "Harmonicity"]) {
    await expect(readout(panel, name)).toBeVisible();
  }
  await expect(readout(panel, "Volume")).toHaveValue("0");
  await expect(readout(panel, "Harmonicity")).toHaveValue("3.00");

  for (const name of [
    "Oscillator",
    "Envelope",
    "Modulation",
    "Modulation Envelope",
  ]) {
    await expect(sectionTrigger(panel, name)).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  }

  await expect(panel.getByRole("button", { name: "Add event" })).toBeVisible();
  await expect(panel.getByTestId("event-row")).toHaveCount(1);
});

test("gives a bounded param a slider and an open-ended one a field only", async ({
  page,
}) => {
  const panel = await addSynth(page);

  await expect(panel.getByRole("slider", { name: "Volume" })).toHaveCount(1);
  await expect(panel.getByRole("slider", { name: "Portamento" })).toHaveCount(
    0,
  );
  await expect(readout(panel, "Portamento")).toBeVisible();
});

test("moves a param with its slider", async ({ page }) => {
  const panel = await addSynth(page);
  const slider = panel.getByRole("slider", { name: "Volume" });

  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");

  await expect(readout(panel, "Volume")).toHaveValue("-2");
  await expect(slider).toHaveAttribute("aria-valuenow", "-2");
});

test("sets a param by typing, clamped to its range", async ({ page }) => {
  const panel = await addSynth(page);

  await typeValue(panel, "Volume", "-12");
  await expect(readout(panel, "Volume")).toHaveValue("-12");
  await expect(panel.getByRole("slider", { name: "Volume" })).toHaveAttribute(
    "aria-valuenow",
    "-12",
  );

  await typeValue(panel, "Volume", "100");
  await expect(readout(panel, "Volume")).toHaveValue("12");
});

test("throws away a typed value that is not a number", async ({ page }) => {
  const panel = await addSynth(page);

  await typeValue(panel, "Harmonicity", "lots");

  await expect(readout(panel, "Harmonicity")).toHaveValue("3.00");
});

test("drops a half-typed value on Escape", async ({ page }) => {
  const panel = await addSynth(page);
  const field = readout(panel, "Harmonicity");

  await field.fill("7");
  await field.press("Escape");

  await expect(field).toHaveValue("3.00");
});

test("opens a section to reveal its params", async ({ page }) => {
  const panel = await addSynth(page);
  await expect(readout(panel, "Pulse Width")).toHaveCount(0);

  const oscillator = await openSection(panel, "Oscillator");

  await expect(readout(oscillator, "Pulse Width")).toHaveValue("0.50");
  await expect(readout(oscillator, "PWM Frequency")).toHaveValue("0.40");
});

test("picks a waveform and shows it on the closed section", async ({
  page,
}) => {
  const panel = await addSynth(page);
  const trigger = sectionTrigger(panel, "Modulation");
  await expect(trigger).toContainText("square");

  const modulation = await openSection(panel, "Modulation");
  await modulation.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "triangle" }).click();
  await expect(
    modulation
      .getByRole("combobox", { name: "Type" })
      .locator("[data-slot=select-value]"),
  ).toHaveText("triangle");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toContainText("triangle");
});

test("draws the envelope and redraws it as a stage changes", async ({
  page,
}) => {
  const panel = await addSynth(page);
  const envelope = await openSection(panel, "Envelope");
  const curve = envelope
    .getByRole("img", { name: "Envelope shape" })
    .locator("polyline");
  const before = await curve.getAttribute("points");

  await typeValue(envelope, "Attack", "2");

  await expect(readout(envelope, "Attack")).toHaveValue("2.00");
  await expect(curve).not.toHaveAttribute("points", before ?? "");
});

test("keeps each envelope's stages apart", async ({ page }) => {
  const panel = await addSynth(page);
  const envelope = await openSection(panel, "Envelope");
  const modulation = await openSection(panel, "Modulation Envelope");

  await typeValue(envelope, "Attack", "1.5");

  await expect(readout(envelope, "Attack")).toHaveValue("1.50");
  await expect(readout(modulation, "Attack")).toHaveValue("0.50");
});

test("offers automation only on params that take it", async ({ page }) => {
  const panel = await addSynth(page);

  // Volume, Detune and Harmonicity automate; Portamento does not.
  await expect(panel.getByTestId("automation-trigger")).toHaveCount(3);
  await expect(
    panel.getByRole("button", { name: "Automate Volume" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Automate Portamento" }),
  ).toHaveCount(0);
});

test("schedules and removes automation on a param", async ({ page }) => {
  const panel = await addSynth(page);
  const automate = panel.getByRole("button", { name: "Automate Volume" });

  await automate.click();
  const editor = page.getByRole("dialog", { name: "Automate Volume" });
  await expect(editor).toBeVisible();

  await editor.getByRole("button", { name: "Ramp" }).click();
  // Enter would submit the form there and then, so the value is left to land
  // when focus moves on to the next field.
  await readout(editor, "Value").fill("-6");
  await editor.getByRole("textbox", { name: "Starting at" }).fill("1");
  await editor.getByRole("textbox", { name: "Over" }).fill("2");
  await editor.getByRole("button", { name: "Add change" }).click();

  const scheduled = editor.getByRole("list", { name: "Scheduled changes" });
  await expect(scheduled.getByRole("listitem")).toHaveText([
    "Ramp to -6 dB over 2, starting at 1",
  ]);
  await expect(automate).toContainText("1");

  // The form keeps what was typed, so a second change can reuse it.
  await editor.getByRole("button", { name: "Set", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "Over" })).toHaveCount(0);
  await editor.getByRole("button", { name: "Add change" }).click();
  await expect(scheduled.getByRole("listitem")).toHaveCount(2);
  await expect(scheduled.getByRole("listitem").last()).toHaveText(
    "Set to -6 dB, at 1",
  );

  await scheduled
    .getByRole("button", {
      name: "Remove: Ramp to -6 dB over 2, starting at 1",
    })
    .click();
  await expect(scheduled.getByRole("listitem")).toHaveText([
    "Set to -6 dB, at 1",
  ]);
});

test("offers only the automation a param allows", async ({ page }) => {
  const panel = await addSynth(page);

  await panel.getByRole("button", { name: "Automate Detune" }).click();
  const editor = page.getByRole("dialog", { name: "Automate Detune" });

  await expect(editor.getByRole("group", { name: "Change type" })).toHaveText(
    "SetRampLinear",
  );
});

test("drags the panel by its header but not by its controls", async ({
  page,
}) => {
  const panel = await addSynth(page);
  const at = await blockAt(page);

  const slider = await boxOf(
    panel.getByRole("slider", { name: "Harmonicity" }).locator(".."),
    "harmonicity slider",
  );
  await drag(page, slider, 40, 80);
  await expect(readout(panel, "Harmonicity")).not.toHaveValue("3.00");
  expect(await blockAt(page)).toBe(at);

  const header = await boxOf(
    panel.getByRole("heading", { name: "AMSynth" }),
    "header",
  );
  await drag(page, header, 120, 60);
  await expect(async () => {
    expect(await blockAt(page)).not.toBe(at);
  }).toPass();
});

test("deletes the synth from the canvas", async ({ page }) => {
  const panel = await addSynth(page);

  await panel.getByRole("heading", { name: "AMSynth" }).click();
  await page.getByTestId("delete-selection").click();

  await expect(instrument(page)).toHaveCount(0);
});
