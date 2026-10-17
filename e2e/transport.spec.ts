import { expect, test } from "./fixtures";

test("sets the tempo", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const bpm = page.getByLabel("BPM");
  await bpm.fill("90");
  await bpm.press("Enter");
  await expect(bpm).toHaveValue("90");
  expect(errors).toEqual([]);
});
