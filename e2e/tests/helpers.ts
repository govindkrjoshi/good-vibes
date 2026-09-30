import { type Locator, type Page } from "@playwright/test";

export const toolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Rack tools" });

/** React Flow paints the canvas itself, so its own class is the only handle. */
export const canvas = (page: Page) => page.locator(".react-flow__pane");

export const blocks = (page: Page) => page.getByTestId("block-node");

/** The island a control floats in, found from the control itself. */
export const island = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .locator("xpath=ancestor-or-self::*[@data-slot='island'][1]");

/**
 * A locator's box. `boundingBox()` answers null for anything not rendered, and
 * throwing beats returning null inside a retrying block: the throw is what asks
 * for another attempt once the layout has settled.
 */
export async function boxOf(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`no ${label} box`);
  return box;
}

/**
 * Where a block sits on the canvas, read off the node's transform. A screen
 * box cannot tell a moved block from a panned canvas; this can.
 */
export const blockAt = (page: Page, index = 0) =>
  page
    .locator(".react-flow__node")
    .nth(index)
    .evaluate((node) => (node as HTMLElement).style.transform);

/**
 * A block's jack handle, picked by the direction the jack declares. The app
 * names its jacks `<block>:in` and `<block>:out` and React Flow copies that
 * into `data-handleid`, so this keys off the app's own data rather than which
 * side React Flow happened to paint the handle on.
 */
export const handle = (page: Page, index: number, direction: "in" | "out") =>
  blocks(page).nth(index).locator(`[data-handleid$=":${direction}"]`);

/** Drags from the middle of `box` by `dx`/`dy`, in screen pixels. */
export async function drag(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // Raw mouse moves rather than hover(): a locked block takes no pointer
  // events, so Playwright would refuse to target it.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/**
 * Drags a connection from the `from` handle to the `to` handle, and hands back
 * whether React Flow was willing to end it there. It marks the handle under
 * the cursor `valid` only while `isValidConnection` accepts the drop, so this
 * reads the answer the canvas gave before the drop, not just its aftermath.
 */
export async function connect(page: Page, from: Locator, to: Locator) {
  const start = await boxOf(from, "source handle");
  const end = await boxOf(to, "target handle");

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 10,
  });

  const valid = await to.evaluate((node) => node.classList.contains("valid"));
  await page.mouse.up();

  return valid;
}
