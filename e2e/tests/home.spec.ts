import { expect, test, type Page } from "@playwright/test";
import { openSandboxPage, toolbar } from "./helpers";

const island = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .locator("xpath=ancestor-or-self::*[@data-slot='island'][1]");

test("floats an island in each corner around the canvas", async ({ page }) => {
  await openSandboxPage(page);

  const canvasBox = await page.locator(".react-flow__pane").boundingBox();
  if (canvasBox === null) throw new Error("no canvas box");

  const corners = {
    "canvas-menu": { top: true, left: true },
    "zoom-out": { top: false, left: true },
    help: { top: false, left: false },
  } as const;

  for (const [testId, corner] of Object.entries(corners)) {
    const box = await island(page, testId).boundingBox();
    if (box === null) throw new Error(`no island box for ${testId}`);

    // Floating means overlapping the canvas rather than sitting beside it.
    expect(box.y).toBeGreaterThan(canvasBox.y);
    expect(box.y + box.height).toBeLessThan(canvasBox.y + canvasBox.height);

    expect(box.y < canvasBox.y + canvasBox.height / 2).toBe(corner.top);
    expect(box.x < canvasBox.x + canvasBox.width / 2).toBe(corner.left);
  }
});

test("centres the tool island at the top of the canvas", async ({ page }) => {
  await openSandboxPage(page);

  const canvasBox = await page.locator(".react-flow__pane").boundingBox();
  const barBox = await toolbar(page).boundingBox();
  if (canvasBox === null || barBox === null) throw new Error("no layout box");

  const barCentre = barBox.x + barBox.width / 2;
  const canvasCentre = canvasBox.x + canvasBox.width / 2;
  expect(Math.abs(barCentre - canvasCentre)).toBeLessThan(2);
  expect(barBox.y).toBeLessThan(canvasBox.y + canvasBox.height / 2);
});

test("exposes every rack tool as a named control", async ({ page }) => {
  await openSandboxPage(page);

  for (const name of ["Add node", "Add group", "Lock canvas"]) {
    await expect(toolbar(page).getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Canvas menu" })).toBeVisible();
});

test("shows a tooltip and moves focus with the arrow keys", async ({
  page,
}) => {
  await openSandboxPage(page);

  const addNode = page.getByTestId("add-node");
  await addNode.hover();
  // Base UI renders the popup without a tooltip role, so key off its slot.
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    "Add node",
  );

  await addNode.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("add-group")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(addNode).toBeFocused();
});

test("toggles the lock button between its two states", async ({ page }) => {
  await openSandboxPage(page);

  const lock = page.getByTestId("toggle-lock");
  await expect(lock).toHaveAttribute("aria-label", "Lock canvas");

  await lock.click();
  await expect(lock).toHaveAttribute("aria-label", "Unlock canvas");
  await expect(lock).toHaveAttribute("data-active", "true");

  await lock.click();
  await expect(lock).toHaveAttribute("aria-label", "Lock canvas");
});

test("zooms the canvas from the bottom-left island", async ({ page }) => {
  await openSandboxPage(page);

  const level = page.getByTestId("zoom-level");
  await expect(level).toHaveText("100%");

  await page.getByTestId("zoom-in").click();
  await expect(level).not.toHaveText("100%");

  await level.click();
  await expect(level).toHaveText("100%");

  await expect(page.getByTestId("undo")).toBeDisabled();
  await expect(page.getByTestId("redo")).toBeDisabled();
});

test("lists the keyboard shortcuts behind the help button", async ({
  page,
}) => {
  await openSandboxPage(page);

  await page.getByTestId("help").click();
  const popover = page.locator('[data-slot="popover-content"]');

  await expect(popover).toBeVisible();
  for (const key of ["N", "G", "R"]) {
    await expect(popover.getByText(key, { exact: true })).toBeVisible();
  }
});

test("opens the canvas menu from the top-left island", async ({ page }) => {
  await openSandboxPage(page);

  await page.getByTestId("canvas-menu").click();
  const menu = page.getByRole("menu");

  await expect(menu).toBeVisible();
  for (const item of ["Fit view", "Zoom to 100%", "Run rack"]) {
    await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
  }
});

test("embeds the sandbox as a hidden script-only iframe", async ({ page }) => {
  await openSandboxPage(page);

  const iframe = page.locator('iframe[title="Code sandbox"]');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("src", "/sandbox.html");
  await expect(iframe).toBeHidden();
});

test("logs to the console once the sandbox provider mounts", async ({
  page,
}) => {
  const logs: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "log") logs.push(message.text());
  });

  await openSandboxPage(page);

  await expect(() => expect(logs).toContain("Sandbox loaded")).toPass();
});
