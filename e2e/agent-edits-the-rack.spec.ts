import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const chat = (page: Page) => page.getByTestId("chat-panel");
const actions = (page: Page) => page.getByTestId("chat-action");
const nodes = (page: Page) => page.locator(".react-flow__node");

const ask = async (page: Page, text: string) => {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-input").press("Enter");
};

test.describe("building a rack in one go", () => {
  test.use({
    openRouterReplies: [
      {
        tool: "rack_actions",
        args: {
          actions: [
            {
              kind: "add_block",
              id: "synth-1",
              category: "instruments",
              entry: "AMSynth",
            },
            {
              kind: "add_block",
              id: "speakers",
              category: "output",
              entry: "Destination",
            },
            {
              kind: "connect_blocks",
              fromBlockId: "synth-1",
              toBlockId: "speakers",
            },
            { kind: "set_param", paramId: "synth-1:param:volume", value: -6 },
          ],
        },
      },
      "Added a synth you can hear once you press Run.",
    ],
  });

  test("puts the blocks on the canvas and shows each step in the chat", async ({
    page,
  }) => {
    await expect(nodes(page)).toHaveCount(0);

    await ask(page, "add a synth I can hear");

    await expect(nodes(page)).toHaveCount(2);
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Volume" })).toHaveValue(
      "-6",
    );
    await expect(actions(page)).toHaveCount(4);
    for (const row of await actions(page).all())
      await expect(row).toHaveAttribute("data-status", "done");
    await expect(actions(page).first()).toContainText(
      "Added AMSynth as synth-1.",
    );
    await expect(actions(page).last()).toContainText(
      "Set AMSynth Volume to -6 dB.",
    );
    await expect(chat(page)).toContainText(
      "Added a synth you can hear once you press Run.",
    );
  });
});

test.describe("a change the rack refuses", () => {
  test.use({
    openRouterReplies: [
      {
        tool: "rack_actions",
        args: {
          actions: [
            { kind: "add_block", id: "fx-1", category: "fx", entry: "Reverb" },
            {
              kind: "add_block",
              id: "speakers",
              category: "output",
              entry: "Destination",
            },
          ],
        },
      },
      "There is no reverb yet.",
    ],
  });

  test("shows why, and goes no further down the list", async ({ page }) => {
    await ask(page, "add a reverb");

    await expect(actions(page)).toHaveCount(1);
    await expect(actions(page).first()).toHaveAttribute(
      "data-status",
      "failed",
    );
    await expect(actions(page).first()).toContainText(
      "There is no fx/Reverb in the catalogue.",
    );
    await expect(chat(page)).toContainText("There is no reverb yet.");
    await expect(nodes(page)).toHaveCount(0);
  });
});

test.describe("checking for errors", () => {
  test.use({
    openRouterReplies: [
      { tool: "rack_actions", args: { actions: [{ kind: "check_errors" }] } },
      "Your Leaf block has no code yet.",
    ],
  });

  test("finds a leaf the user added that did not build", async ({ page }) => {
    await page.getByTestId("add-source").click();
    await expect(page.getByTestId("block-error")).toBeVisible();

    await ask(page, "is anything broken?");

    await expect(actions(page)).toHaveCount(1);
    await expect(actions(page).first()).toHaveAttribute("data-status", "done");
    await expect(actions(page).first()).toContainText("1 problem.");
    await expect(actions(page).first()).toContainText(
      "it did not build: Leaf has no code",
    );
    await expect(chat(page)).toContainText("Your Leaf block has no code yet.");
  });
});

test.describe("building and checking in one list", () => {
  test.use({
    openRouterReplies: [
      {
        tool: "rack_actions",
        args: {
          actions: [
            {
              kind: "add_block",
              id: "synth-1",
              category: "instruments",
              entry: "AMSynth",
            },
            {
              kind: "add_block",
              id: "speakers",
              category: "output",
              entry: "Destination",
            },
            {
              kind: "connect_blocks",
              fromBlockId: "synth-1",
              toBlockId: "speakers",
            },
            { kind: "check_errors" },
          ],
        },
      },
      "All wired up.",
    ],
  });

  test("waits for the audio engine to build what came before the check", async ({
    page,
  }) => {
    await ask(page, "add a synth I can hear");

    await expect(actions(page)).toHaveCount(4);
    await expect(actions(page).last()).toHaveAttribute("data-status", "done");
    await expect(actions(page).last()).toContainText("No errors");
    await expect(chat(page)).toContainText("All wired up.");
  });
});

test.describe("fixing errors left after a turn", () => {
  test.use({
    openRouterReplies: [
      "Sure.",
      "That Leaf block has no code, and I cannot write code for it.",
    ],
  });

  test("asks the agent to fix errors, the user's too, and stops when nothing changes", async ({
    page,
  }) => {
    await page.getByTestId("add-source").click();
    await expect(page.getByTestId("block-error")).toBeVisible();

    await ask(page, "hello");

    const notices = page.getByTestId("chat-notice");
    await expect(notices.first()).toHaveText(
      "Found 1 error; asking the agent to fix it.",
    );
    await expect(chat(page)).toContainText(
      "That Leaf block has no code, and I cannot write code for it.",
    );
    await expect(notices.last()).toHaveText(
      "The last fix changed nothing about the 1 error, so the agent has stopped trying.",
    );
    await expect(page.getByTestId("chat-stop")).toHaveCount(0);
  });
});
