import { type Locator, type Page } from "@playwright/test";

export const toolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Rack tools" });

export const canvas = (page: Page) => page.locator(".react-flow__pane");

export const blocks = (page: Page) => page.getByTestId("block-node");

export const island = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .locator("xpath=ancestor-or-self::*[@data-slot='island'][1]");

export async function boxOf(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`no ${label} box`);
  return box;
}

export const blockAt = (page: Page, index = 0) =>
  page
    .locator(".react-flow__node")
    .nth(index)
    .evaluate((node) => (node as HTMLElement).style.transform);

export const handle = (page: Page, index: number, direction: "in" | "out") =>
  blocks(page).nth(index).locator(`[data-handleid$=":${direction}"]`);

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

// React Flow spends the pointer's first move on starting the drag, so that
// move is a small one and the rest of the distance is exact.
export async function dragExactly(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 3, y);
  await page.mouse.move(x + dx + 3, y + dy, { steps: 10 });
  await page.mouse.up();
}

// Waits until the canvas stops moving: the racks are laid out again after
// every change, and the view is fitted to them.
export async function settle(page: Page) {
  const snapshot = () =>
    page
      .locator(".react-flow")
      .evaluate((flow) =>
        [
          ...flow.querySelectorAll<HTMLElement>(
            ".react-flow__viewport, .react-flow__node",
          ),
        ]
          .map(
            ({ style }) => `${style.transform} ${style.width} ${style.height}`,
          )
          .join("|"),
      );
  let last = await snapshot();
  for (let still = 0; still < 2;) {
    await page.waitForTimeout(100);
    const next = await snapshot();
    still = next === last ? still + 1 : 0;
    last = next;
  }
}

export async function connect(page: Page, from: Locator, to: Locator) {
  await settle(page);
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

// Adds a catalogue item by its key (`pluginId/name`) through the toolbar's
// search, browsing to its category as a user picking one would.
export async function addBlock(page: Page, category: string, itemKey: string) {
  await page.getByTestId("catalogue-search").click();
  await page.getByTestId(`catalogue-${category}`).click();
  await page.getByTestId(`catalogue-item-${itemKey}`).click();
  await settle(page);
}
