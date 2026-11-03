import { expect, test } from "./fixtures";
import { addBlock, blocks } from "./helpers";

const racks = (page: Parameters<typeof blocks>[0]) =>
  page.locator(".react-flow__node");

test("loads a demo onto an empty canvas and lays it out", async ({ page }) => {
  await page.getByTestId("load-demo").click();
  await page.getByTestId("demo-dub-pulse").click();

  await expect(racks(page)).toHaveCount(10);
  // Laid out along the signal flow, so no two racks share a spot.
  await expect
    .poll(async () => {
      const transforms = await racks(page).evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).style.transform),
      );
      return new Set(transforms).size;
    })
    .toBe(10);
});

test("asks before a demo replaces what is on the canvas", async ({ page }) => {
  await addBlock(page, "components", "tone/Mono");
  await expect(blocks(page)).toHaveCount(1);

  await page.getByTestId("load-demo").click();
  await page.getByTestId("demo-sidechain-garden").click();
  await expect(
    page.getByText("Replace the canvas with Sidechain Garden?"),
  ).toBeVisible();
  await page.getByTestId("confirm-load-demo").click();

  await expect(racks(page)).toHaveCount(20);
  await expect(page.getByText("Kick · MembraneSynth")).toBeVisible();
});

test("loads the big session into groups", async ({ page }) => {
  await page.getByTestId("load-demo").click();
  await page.getByTestId("demo-generative-session").click();

  await expect(racks(page)).toHaveCount(100);
  await expect(page.getByTestId("tree-node")).toHaveCount(8);
});
