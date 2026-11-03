import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { addBlock, blocks, boxOf, connect } from "./helpers";

const racks = (page: Page) => page.locator(".react-flow__node");

const socket = (rack: Locator, direction: "in" | "out") =>
  rack.locator(`[data-handleid$=":${direction}"]`);

type Box = Awaited<ReturnType<typeof boxOf>>;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

test("lays a demo out with no two racks on top of each other", async ({
  page,
}) => {
  await page.getByTestId("load-demo").click();
  await page.getByTestId("demo-dub-pulse").click();
  await expect(racks(page)).toHaveCount(10);

  await expect(async () => {
    const boxes = await Promise.all(
      (await racks(page).all()).map((rack, index) =>
        boxOf(rack, `rack ${index}`),
      ),
    );
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1))
        expect(overlaps(a, b)).toBe(false);
    }
  }).toPass();
});

test("puts a rack beside the last one added instead of on top of it", async ({
  page,
}) => {
  await page.getByTestId("add-destination").click();
  await page.getByTestId("add-destination").click();
  await expect(blocks(page)).toHaveCount(2);

  await expect(async () => {
    const first = await boxOf(blocks(page).nth(0), "first");
    const second = await boxOf(blocks(page).nth(1), "second");
    expect(overlaps(first, second)).toBe(false);
  }).toPass();
});

test("moves a rack right of what it is patched from", async ({ page }) => {
  await addBlock(page, "components", "tone/Mono");
  await page.getByTestId("add-destination").click();
  await expect(blocks(page)).toHaveCount(2);
  const mono = blocks(page).filter({ hasText: "Mono" });
  const destination = blocks(page).filter({ hasText: "Destination" });

  await connect(page, socket(mono, "out"), socket(destination, "in"));

  await expect(async () => {
    const from = await boxOf(mono, "mono");
    const to = await boxOf(destination, "destination");
    expect(to.x).toBeGreaterThan(from.x + from.width);
  }).toPass();
});
