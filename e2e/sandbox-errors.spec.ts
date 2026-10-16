import { expect, test } from "./fixtures";
import { buildRiff, expectPlaying, expectSilent, open } from "./audio";
import { blocks, connect } from "./helpers";

test("shows on its node why a leaf did not build, and keeps it after a retry that fails again", async ({
  page,
}) => {
  await open(page, false);

  await page.getByTestId("add-source").click();

  const error = blocks(page).getByTestId("block-error");
  await expect(error).toContainText("Didn't build");
  await expect(error).toContainText("Leaf has no code");
  await expect(error).toHaveAttribute("data-code", "LeafThrew");

  await error.getByTestId("retry-block").click();
  await expect(error).toContainText("Leaf has no code");
});

test("draws a patch from a leaf that did not build as broken", async ({
  page,
}) => {
  await open(page, false);
  await page.getByTestId("add-source").click();
  await page.keyboard.press("d");
  await expect(blocks(page)).toHaveCount(2);

  await connect(
    page,
    blocks(page).first().locator("[data-handleid$=':out']"),
    blocks(page).last().locator("[data-handleid$=':in']"),
  );

  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.locator(".react-flow__edge.edge-error")).toHaveCount(1);
});

test("picks up again after the sandbox frame reloads mid-play, silent until Run", async ({
  page,
}) => {
  await open(page, false);
  await buildRiff(page);
  await page.getByTestId("run-rack").click();
  await expectPlaying(page);

  await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Code sandbox"]',
    );
    if (frame !== null) frame.src = frame.src;
  });
  await expectSilent(page);

  await page.getByTestId("run-rack").click();
  await expectPlaying(page);
  await expect(page.getByTestId("sandbox-notice")).toHaveCount(0);
});
