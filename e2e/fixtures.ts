import { expect, test as base, type Page } from "@playwright/test";
import { toolbar } from "./helpers";

export { expect };

// The key the app finds in local storage, so it never stops to ask for one.
const fakeCredential = JSON.stringify({
  provider: "openrouter",
  key: "sk-or-e2e",
});
const credentialStorageKey = "good-vibes:agent-credential";

const fallbackReply = "Hello from Good Vibes.";

// One reply from the fake model: what it says, or the tools it calls.
export type ScriptedReply =
  string | { readonly toolCalls: readonly { name: string; args: object }[] };

// OpenRouter's chat-completions stream, cut down to what pi-ai reads.
const completion = (reply: ScriptedReply) => {
  const chunks =
    typeof reply === "string"
      ? [
          {
            choices: [
              { index: 0, delta: { role: "assistant", content: reply } },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ]
      : [
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: reply.toolCalls.map((call, index) => ({
                    index,
                    id: `call-${index}`,
                    type: "function",
                    function: {
                      name: call.name,
                      arguments: JSON.stringify(call.args),
                    },
                  })),
                },
              },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
        ];
  return (
    chunks
      .map(
        (chunk) =>
          `data: ${JSON.stringify({
            id: "gen",
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            ...chunk,
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n"
  );
};

export async function openSandboxPage(page: Page) {
  // The toolbar is server-rendered, so it shows up before hydration and cannot
  // gate interaction: a click landing first is silently dropped. The provider's
  // mount log is the signal that handlers are attached.
  const hydrated = page.waitForEvent(
    "console",
    (message) =>
      message.type() === "log" && message.text() === "Sandbox loaded",
  );
  await page.goto("/");
  await hydrated;
  await expect(toolbar(page)).toBeVisible();
}

type Options = {
  // What the fake OpenRouter says, one reply per request in order; once they
  // run out it keeps giving the fallback.
  readonly openRouterReplies: readonly ScriptedReply[];
};

export const test = base.extend<Options>({
  openRouterReplies: [[], { option: true }],

  // Faked on the context, not the page, so pages a test opens itself are
  // covered too and no run ever reaches the real model or spends a key.
  context: async ({ context, openRouterReplies }, use) => {
    const replies = [...openRouterReplies];
    await context.addInitScript(
      ([key, value]) => {
        try {
          localStorage.setItem(key, value);
        } catch {
          // Opaque-origin documents, like the sandbox, have no storage.
        }
      },
      [credentialStorageKey, fakeCredential] as const,
    );
    await context.route("https://openrouter.ai/**", (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "access-control-allow-origin": "*",
        },
        body: completion(replies.shift() ?? fallbackReply),
      }),
    );
    await use(context);
  },

  page: async ({ page }, use) => {
    await openSandboxPage(page);
    await use(page);
  },
});
